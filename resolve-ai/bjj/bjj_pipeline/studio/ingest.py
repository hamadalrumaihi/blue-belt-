"""Stage 1 - ingest and index.

For every file under the given sources (files or folders):
  * probe it (bjj_pipeline.media.probe); decode-test the first seconds so a
    damaged file is reported up front instead of crashing a render later,
  * content-hash it (fast sampled hash; size+mtime short-circuit on re-ingest),
  * build a constant-frame-rate H.264 proxy (short GOP -> fast seeking) and a
    contact sheet - originals are never modified, moved or re-encoded in place,
  * detect exact duplicates (same hash) and *possible* overlapping recordings of
    the same moment (audio-envelope cross-correlation between clips),
  * group related clips (overlap evidence, else capture-time proximity) and
    record how strong the evidence is.  Groups are suggestions, never facts.
"""
from __future__ import annotations

import math
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import numpy as np

from ..media import probe
from ..util import LOG, VIDEO_EXTS, ffmpeg_path
from .jobs import StudioError, log_event, run_tool, stage
from .project import Project, file_hash, fingerprint

PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".heic", ".dng", ".cr3", ".arw", ".nef"}
PROXY_MAX_FPS = 60
ENV_RATE = 50          # audio envelope samples per second for overlap search


def discover(sources: list[str | Path]) -> list[Path]:
    out: list[Path] = []
    for s in sources:
        s = Path(s).expanduser()
        if not s.exists():
            raise StudioError(f"source not found: {s}", "check the path / that the drive is connected")
        if s.is_file():
            out.append(s)
        else:
            out += sorted(p for p in s.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTS | PHOTO_EXTS
                          and not p.name.startswith("._"))
    return out


def _kind(p: Path) -> str:
    return "photo" if p.suffix.lower() in PHOTO_EXTS else "video"


def decode_test(proj: Project, path: Path, label: str, seconds: float = 3.0) -> list[str]:
    """Decode the start, middle and end of a file; return ffmpeg error lines (empty = clean)."""
    errors: list[str] = []
    try:
        info = probe(path)
        spots = [0.0] + ([max(0.0, info.duration / 2 - seconds / 2), max(0.0, info.duration - seconds)]
                         if info.duration > 3 * seconds else [])
    except Exception as exc:  # probe itself failed
        return [f"probe failed: {exc}"]
    for i, ss in enumerate(spots):
        cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-ss", f"{ss:.3f}", "-i", str(path), "-t", str(seconds),
               "-f", "null", "-"]
        res = subprocess.run(cmd, capture_output=True, text=True, errors="replace",
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if res.returncode != 0 or res.stderr.strip():
            errors += [f"@{ss:.1f}s: {ln}" for ln in res.stderr.strip().splitlines()[:3]] or [f"@{ss:.1f}s: exit {res.returncode}"]
    return errors


def make_proxy(proj: Project, asset: dict) -> str:
    """CFR H.264 proxy, long side 1280, GOP 0.5 s, AAC 48 kHz stereo (silent track added if none)."""
    out = proj.p("cache", "proxies", f"{asset['id']}.mp4")
    if out.exists() and out.stat().st_size > 0:
        return str(out.relative_to(proj.root))
    fps = min(PROXY_MAX_FPS, round(asset["fps_float"] or 30))
    w, h = asset["width"], asset["height"]
    scale = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))':flags=bicubic"
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", asset["source"]]
    if not asset["has_audio"]:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    cmd += ["-map", "0:v:0", "-map", "0:a:0" if asset["has_audio"] else "1:a:0",
            "-vf", f"{scale},fps={fps},format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-g", str(max(1, fps // 2)), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-shortest",
            "-movflags", "+faststart", str(out.with_suffix(".tmp.mp4"))]
    run_tool(cmd, project_root=proj.root, label=f"proxy_{asset['id']}", timeout=max(600, asset["duration"] * 6),
             cancel_check=proj.cancelled)
    out.with_suffix(".tmp.mp4").replace(out)
    return str(out.relative_to(proj.root))


def contact_sheet(proj: Project, asset: dict, cols: int = 6, rows: int = 4) -> str:
    out = proj.p("cache", "thumbs", f"{asset['id']}.jpg")
    if out.exists():
        return str(out.relative_to(proj.root))
    src = proj.root / asset["proxy"] if asset.get("proxy") else Path(asset["source"])
    if asset["kind"] == "photo":
        vf = "scale=480:-2"
        cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(src), "-vf", vf, "-frames:v", "1", str(out)]
    else:
        n = cols * rows
        step = max(asset["duration"] / n, 0.04)
        vf = (f"fps=1/{step:.4f},scale=240:-2,drawtext=text='%{{pts\\:hms}}':x=4:y=4:fontsize=14:fontcolor=white:"
              f"box=1:boxcolor=black@0.6,tile={cols}x{rows}")
        cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(src), "-vf", vf, "-frames:v", "1", str(out)]
    run_tool(cmd, project_root=proj.root, label=f"thumb_{asset['id']}", timeout=600, cancel_check=proj.cancelled)
    return str(out.relative_to(proj.root))


def audio_envelope(path: Path, rate: int = ENV_RATE, bands: int = 12) -> np.ndarray:
    """Multi-band onset envelope, shape (bands, frames) at `rate` Hz.

    Per band: positive differences of log energy, standardised.  Gain differences
    between cameras cancel out; independent background noise does not correlate
    across bands, while shared events (whistle, slap, crowd, referee) do."""
    sr = 8000
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    res = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    pcm = np.frombuffer(res.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    hop, win = sr // rate, 256
    n = (pcm.size - win) // hop
    if n < rate * 2:
        return np.zeros((bands, 0), dtype=np.float32)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    spec = np.abs(np.fft.rfft(pcm[idx] * np.hanning(win), axis=1)) ** 2          # (n, 129)
    freqs = np.fft.rfftfreq(win, 1 / sr)
    edges = np.geomspace(100, 3800, bands + 1)
    out = np.zeros((bands, n), dtype=np.float32)
    for b in range(bands):
        sel = (freqs >= edges[b]) & (freqs < edges[b + 1])
        e = np.log10(spec[:, sel].sum(axis=1) + 1e-8)
        on = np.clip(np.diff(e, prepend=e[0]), 0, None)
        sd = on.std()
        out[b] = (on - on.mean()) / sd if sd > 1e-6 else 0.0
    return out


def _pearson(x: np.ndarray, y: np.ndarray) -> float:
    x = x - x.mean()
    y = y - y.mean()
    d = math.sqrt(float((x * x).sum()) * float((y * y).sum()))
    return float((x * y).sum() / d) if d > 1e-9 else 0.0


def find_overlap(a: np.ndarray, b: np.ndarray, rate: int = ENV_RATE, min_overlap_s: float = 6.0,
                 window_s: float = 4.0) -> dict | None:
    """Find where clip b sits inside clip a's timeline.  offset_s = (time in a) - (time in b) for the same moment.

    1. multi-band cross-correlation (sum of per-band FFT xcorr) proposes the best lag;
    2. the lag is *verified* window by window (Pearson per 4 s window): one shared
       loud event can fake a peak, real overlapping recordings agree in most windows.
    """
    if a.ndim == 1:
        a, b = a[None, :], b[None, :]
    na, nb = a.shape[1], b.shape[1]
    if na < rate * min_overlap_s or nb < rate * min_overlap_s:
        return None
    n = 1 << int(math.ceil(math.log2(na + nb)))
    corr = np.fft.irfft((np.fft.rfft(a, n, axis=1) * np.conj(np.fft.rfft(b, n, axis=1))).sum(axis=0), n)
    lags = np.concatenate([np.arange(0, na), np.arange(-(nb - 1), 0)])
    vals = np.concatenate([corr[:na], corr[n - (nb - 1):]])
    overlap = np.minimum(na - np.maximum(lags, 0), nb + np.minimum(lags, 0)).astype(np.float32)
    ok = overlap >= rate * min_overlap_s
    if not ok.any():
        return None
    norm = np.where(ok, vals / np.maximum(overlap, 1) / a.shape[0], -np.inf)
    k = int(np.argmax(norm))
    lag = int(lags[k])
    a0, b0 = max(lag, 0), max(-lag, 0)
    length = int(overlap[k])
    w = int(rate * window_s)
    rs = []
    for s in range(0, length - w + 1, w):
        rs.append(_pearson(a[:, a0 + s: a0 + s + w].ravel(), b[:, b0 + s: b0 + s + w].ravel()))
    agree = sum(1 for r in rs if r >= 0.3)
    return {"offset_s": round(lag / rate, 3), "score": round(float(norm[k]), 3),
            "windows": len(rs), "windows_agree": agree,
            "window_r_median": round(float(np.median(rs)), 3) if rs else 0.0,
            "overlap_s": round(length / rate, 1)}


def _parse_time(s: str | None) -> datetime | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=None)
        except ValueError:
            continue
    return None


def group_assets(assets: list[dict], overlaps: list[dict], session_gap_s: float = 600) -> list[dict]:
    """Union-find over strong overlap evidence; capture-time proximity forms weaker 'session' groups."""
    ids = [a["id"] for a in assets if a["status"] == "ok"]
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for o in overlaps:
        if o["confidence"] == "high":
            parent[find(o["a"])] = find(o["b"])
    groups: dict[str, list[str]] = {}
    for i in ids:
        groups.setdefault(find(i), []).append(i)
    out = []
    for gid, members in groups.items():
        if len(members) > 1:
            out.append({"id": f"g_{gid[:8]}", "members": sorted(members), "evidence": "audio_overlap",
                        "confidence": "high", "note": "same moment recorded by several cameras/clips (audio match)"})
    # weak session groups by capture time
    timed = sorted(((a, _parse_time(a.get("creation_time"))) for a in assets if a["status"] == "ok"),
                   key=lambda x: x[1] or datetime.max)
    sess: list[list[dict]] = []
    for a, t in timed:
        if t is None:
            continue
        if sess and (t - _parse_time(sess[-1][-1]["creation_time"])).total_seconds() <= session_gap_s:
            sess[-1].append(a)
        else:
            sess.append([a])
    for s in sess:
        if len(s) > 1:
            out.append({"id": f"s_{s[0]['id'][:8]}", "members": [a["id"] for a in s], "evidence": "capture_time",
                        "confidence": "low", "note": f"captured within {int(session_gap_s / 60)} min of each other "
                                                     "(metadata clocks can be wrong - confirm)"})
    return out


def ingest(proj: Project, sources: list[str | Path], *, overlap_threshold: float = 0.25) -> dict:
    files = discover(sources)
    if not files:
        raise StudioError("no media files found in the given sources", "accepted: " + ", ".join(sorted(VIDEO_EXTS | PHOTO_EXTS)))
    prev = {a["source"]: a for a in proj.assets}
    stat_key = [(str(f.resolve()), f.stat().st_size, int(f.stat().st_mtime)) for f in files]
    fp = fingerprint("ingest-v1", stat_key, overlap_threshold)
    with stage(proj, "ingest", fp) as ctx:
        if ctx["skip"]:
            return {"assets": proj.assets, "skipped": True}
        workers = int(proj.state["settings"].get("max_workers", 2))

        def index(f: Path) -> dict:
            src = str(f.resolve())
            st = f.stat()
            old = prev.get(src)
            if old and old.get("size") == st.st_size and old.get("mtime") == int(st.st_mtime) and old["status"] == "ok":
                return old                                  # unchanged: keep cached index (and proxy)
            a: dict = {"source": src, "filename": f.name, "kind": _kind(f), "size": st.st_size,
                       "mtime": int(st.st_mtime), "status": "ok", "problems": []}
            try:
                a["hash"] = file_hash(f)
            except OSError as exc:
                a.update(status="unreadable", problems=[f"cannot read: {exc}"], id="x" + str(abs(hash(src)))[:11])
                return a
            a["id"] = a["hash"].split(":")[1][:12]
            if a["kind"] == "photo":
                try:
                    info = probe(f)
                    a.update(width=info.width, height=info.height, duration=0.0, fps="0/1", fps_float=0.0,
                             has_audio=False, orientation="vertical" if info.height > info.width else "landscape",
                             creation_time=info.creation_time)
                except Exception as exc:
                    a.update(status="unreadable", problems=[f"probe failed: {exc}"])
                return a
            try:
                info = probe(f)
            except Exception as exc:
                a.update(status="unreadable", problems=["ffprobe could not read the file (damaged, incomplete copy or "
                                                     "unsupported container) - re-copy it from the card"])
                return a
            a.update(width=info.width, height=info.height, duration=round(info.duration, 3), fps=info.fps,
                     fps_float=round(info.fps_float, 3), codec=info.codec, has_audio=info.has_audio,
                     audio_channels=info.audio_channels, audio_sample_rate=info.audio_sample_rate,
                     rotation=info.rotation, orientation="vertical" if info.is_vertical else
                     ("square" if info.width == info.height else "landscape"),
                     creation_time=info.creation_time, start_timecode=info.start_timecode,
                     camera_hint=info.camera_hint, problems=list(info.warnings))
            if info.duration <= 0.2:
                a["status"] = "unreadable"
                a["problems"].append("duration ~0 s")
                return a
            errs = decode_test(proj, f, a["id"])
            if errs:
                a["problems"] += errs
                a["status"] = "damaged" if len(errs) >= 2 else "ok"
            return a

        with ThreadPoolExecutor(workers) as ex:
            assets = list(ex.map(index, files))
        # duplicates
        seen: dict[str, str] = {}
        for a in assets:
            if a["status"] != "ok":
                continue
            if a["hash"] in seen:
                a["duplicate_of"] = seen[a["hash"]]
                a["status"] = "duplicate"
                a["id"] = f"{seen[a['hash']]}_dup{sum(1 for x in assets if x.get('duplicate_of') == seen[a['hash']])}"
                a["problems"].append(f"exact duplicate of {seen[a['hash']]} (same content hash)")
            else:
                seen[a["hash"]] = a["id"]
        usable = [a for a in assets if a["status"] == "ok"]
        # proxies + thumbs (bounded concurrency: each ffmpeg already uses several threads)
        def media_work(a: dict) -> None:
            if proj.cancelled():
                return
            if a["kind"] == "video":
                a["proxy"] = make_proxy(proj, a)
            a["thumb"] = contact_sheet(proj, a)

        with ThreadPoolExecutor(max(1, workers // 2) or 1) as ex:
            list(ex.map(media_work, usable))
        if proj.cancelled():
            from .jobs import Cancelled
            raise Cancelled("ingest cancelled", "delete CANCEL and resume")
        # overlaps between videos with audio
        vids = [a for a in usable if a["kind"] == "video" and a.get("has_audio")]
        envs = {a["id"]: audio_envelope(proj.root / a["proxy"]) for a in vids}
        overlaps: list[dict] = []
        for i, a in enumerate(vids):
            for b in vids[i + 1:]:
                r = find_overlap(envs[a["id"]], envs[b["id"]])
                if r and r["windows_agree"] >= 1 and r["window_r_median"] >= overlap_threshold * 0.5:
                    conf = ("high" if r["windows_agree"] >= max(2, math.ceil(0.6 * r["windows"]))
                            and r["window_r_median"] >= overlap_threshold else "low")
                    overlaps.append({"a": a["id"], "b": b["id"], **r, "confidence": conf,
                                     "meaning": f"{b['filename']} t=0 ~ {a['filename']} t={r['offset_s']:+.2f}s"})
        groups = group_assets(usable, overlaps)
        for a in assets:
            a["groups"] = [g["id"] for g in groups if a.get("id") in g["members"]]
        proj.save_assets(assets)
        index_doc = {"overlaps": overlaps, "groups": groups,
                     "counts": {s: sum(1 for a in assets if a["status"] == s) for s in
                                ("ok", "duplicate", "damaged", "unreadable")}}
        from ..util import write_json
        write_json(proj.p("cache", "index.json"), index_doc)
        srcs = sorted({str(Path(s).expanduser().resolve()) for s in sources} | set(proj.state.get("sources", [])))
        proj.state["sources"] = srcs
        proj.save()
        proj.invalidate_from("analyze")
        ctx["outputs"] = ["assets.json", "cache/index.json"]
        ctx["extra"] = {"counts": index_doc["counts"]}
        log_event(proj.root, kind="ingest", **index_doc["counts"], overlaps=len(overlaps), groups=len(groups))
        LOG.info("ingest: %s, %d overlaps, %d groups", index_doc["counts"], len(overlaps), len(groups))
        return {"assets": assets, **index_doc}
