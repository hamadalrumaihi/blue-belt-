"""Stage 2b - reference breakdown (optional).

Measures a reference video and turns it into *reusable editing parameters*
(shot-length targets, hook length, transition mix, camera-move and look
tendencies, beat alignment).  The reference's footage, branding, music and
graphics are never copied into an output: the reference proxy and sheets live
in reference/ only as evidence for the breakdown.

Measurements adapted from ReelMimic's video-clone analyzer
(github.com/edenfunf/reelmimic, .claude/skills/video-clone/scripts/analyze.py,
MIT License, Copyright (c) 2026 ReelMimic contributors): per-shot camera motion
from median optical flow on textured pixels and per-shot look statistics.
Shot detection here uses FFmpeg's scdet filter instead of PySceneDetect so no
extra dependency is needed.

Typography, on-screen text and music *character* are not measured; the
reference-analyst agent fills those in reference/notes.md after looking at
the timestamped sheets.
"""
from __future__ import annotations

import math
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np

from ..analyze import read_audio_rms
from ..media import probe
from ..plan import estimate_beat_interval
from ..util import LOG, ffmpeg_path, read_json, write_json
from .captions import drawtext_font
from .jobs import StudioError, run_tool, stage
from .project import Project, file_hash, fingerprint

REF_VERSION = "ref-v1"


def fetch(proj: Project, src: str) -> Path:
    """Local path, or URL via yt-dlp when installed (never required)."""
    if re.match(r"^https?://", src):
        ytdlp = shutil.which("yt-dlp")
        if not ytdlp:
            raise StudioError(f"reference is a link but yt-dlp is not installed: {src}",
                              "pip install yt-dlp, or download the video yourself and pass the file path")
        out = proj.p("reference", "source.%(ext)s")
        run_tool([ytdlp, "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
                  "-o", str(out), src], project_root=proj.root, label="ref_download", timeout=900)
        hits = sorted(proj.root.joinpath("reference").glob("source.*"))
        if not hits:
            raise StudioError("yt-dlp finished but no file was written", "check logs/ref_download.log")
        return hits[0]
    p = Path(src).expanduser()
    if not p.exists():
        raise StudioError(f"reference not found: {p}")
    return p


def detect_shots(proj: Project, path: Path, threshold: float = 10.0) -> list[float]:
    """Cut times (s) via ffmpeg scdet."""
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), "-an",
           "-vf", f"scale=320:-2,scdet=threshold={threshold}:sc_pass=1,metadata=print:file=-", "-f", "null", "-"]
    res = run_tool(cmd, project_root=proj.root, label="ref_scdet", timeout=1200, capture_stdout=True,
                   cancel_check=proj.cancelled)
    times = [float(m) for m in re.findall(r"lavfi\.scd\.time=([0-9.]+)", res.stdout)]
    out: list[float] = []
    for t in sorted(times):
        if not out or t - out[-1] > 0.2:      # merge flicker
            out.append(round(t, 3))
    return out


def _frames_at(path: Path, ts: list[float], width: int = 320) -> list[np.ndarray]:
    """BGR uint8 frames at the given times (ffmpeg seek; no OpenCV required)."""
    info = probe(path)
    h = max(2, int(round(width * info.height / max(info.width, 1) / 2)) * 2)
    out = []
    for t in ts:
        cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
               "-vf", f"scale={width}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
        r = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if len(r.stdout) == width * h * 3:
            out.append(np.frombuffer(r.stdout, np.uint8).reshape(h, width, 3))
    return out


def shot_details(path: Path, spans: list[tuple[float, float]]) -> list[dict]:
    """Per-shot camera motion + look.  Adapted from ReelMimic analyze.py::_shot_details_part (MIT)."""
    try:
        import cv2
    except ImportError:                       # numpy-only fallback: translation only, no zoom/rotation
        cv2 = None
    out = []
    for i, (a, b) in enumerate(spans):
        n = max(3, min(10, int((b - a) * 5)))
        ts = [a + (b - a) * (k + .5) / n for k in range(n)]
        looks = _frames_at(path, ts)
        if len(looks) < 2:
            continue
        grays = [(0.114 * f[..., 0] + 0.587 * f[..., 1] + 0.299 * f[..., 2]).astype(np.uint8) for f in looks]
        H_, W_ = grays[0].shape
        tx = ty = zoom = rot = 0.0
        if cv2 is not None:
            yy, xx = np.mgrid[0:H_, 0:W_]
            xc, yc = xx - W_ / 2, yy - H_ / 2
            for g0, g1 in zip(grays, grays[1:]):
                fl = cv2.calcOpticalFlowFarneback(g0, g1, None, .5, 3, 21, 3, 5, 1.2, 0)
                u, v = fl[..., 0], fl[..., 1]
                gx = cv2.Sobel(g0, cv2.CV_32F, 1, 0)
                gy = cv2.Sobel(g0, cv2.CV_32F, 0, 1)
                tex = np.hypot(gx, gy) > 40
                if tex.sum() < 200:
                    continue
                uu, vv, xx_, yy_ = u[tex], v[tex], xc[tex], yc[tex]
                tx += float(np.median(uu))
                ty += float(np.median(vv))
                r2 = xx_ ** 2 + yy_ ** 2 + 1e-6
                zoom += float(np.median((uu * xx_ + vv * yy_) / r2))
                rot += float(np.median((vv * xx_ - uu * yy_) / r2))
        else:
            from .footage import _shift_xy
            for g0, g1 in zip(grays, grays[1:]):
                dx, dy = _shift_xy(g0, g1)
                tx -= dx
                ty -= dy
        span = ts[-1] - ts[0] or 1
        mv = {"pan_x": round(tx / W_ / span, 4), "tilt_y": round(ty / H_ / span, 4), "zoom": round(zoom / span, 4),
              "rotate": round(rot / span, 4)}
        kind = []
        if abs(mv["zoom"]) > 0.006:
            kind.append("push_in" if mv["zoom"] > 0 else "pull_out")
        if abs(mv["pan_x"]) > 0.008:
            kind.append("move_left" if mv["pan_x"] > 0 else "move_right")
        if abs(mv["tilt_y"]) > 0.008:
            kind.append("move_up" if mv["tilt_y"] > 0 else "move_down")
        if abs(mv["rotate"]) > 0.01:
            kind.append("roll/orbit")
        mv["kind"] = kind or ["static"]
        mv["speed"] = round(max(abs(mv["pan_x"]), abs(mv["tilt_y"]), abs(mv["zoom"]), abs(mv["rotate"])), 3)
        mv["pace"] = "still" if mv["speed"] < 0.006 else "slow" if mv["speed"] < 0.04 else "medium" if mv["speed"] < 0.12 else "fast"
        px = np.concatenate([f.reshape(-1, 3) for f in looks]).astype(np.float32)
        lum = (0.114 * px[:, 0] + 0.587 * px[:, 1] + 0.299 * px[:, 2]) / 255
        rg = px[:, 2] - px[:, 1]
        yb = 0.5 * (px[:, 2] + px[:, 1]) - px[:, 0]
        colorful = float(np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)) / 255
        warmth = float((px[:, 2].mean() - px[:, 0].mean()) / 255)
        out.append({"shot": i + 1, "start": round(a, 2), "end": round(b, 2), "camera": mv,
                    "look": {"brightness": round(float(lum.mean()), 3), "contrast": round(float(lum.std()), 3),
                             "dark_ratio": round(float((lum < 0.08).mean()), 3), "colourfulness": round(colorful, 3),
                             "warmth": round(warmth, 3)}})
    return out


def flashes(path: Path, duration: float, fps: int = 10) -> list[float]:
    """Times of white/impact flashes (sudden mean-luma jumps up and back)."""
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), "-vf", f"fps={fps},scale=64:36,format=gray",
           "-f", "rawvideo", "-"]
    r = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    a = np.frombuffer(r.stdout, np.uint8)
    n = a.size // (64 * 36)
    if n < 3:
        return []
    m = a[: n * 64 * 36].reshape(n, -1).mean(axis=1)
    out = []
    for i in range(1, n - 1):
        if m[i] - m[i - 1] > 60 and m[i] - m[i + 1] > 40:
            out.append(round(i / fps, 2))
    return out


def sheets(proj: Project, path: Path, spans: list[tuple[float, float]], duration: float) -> list[str]:
    """Timestamped evidence: one mid-frame per shot (up to 48) and one frame per second (up to 64)."""
    out = []
    mids = [round((a + b) / 2, 2) for a, b in spans][:48]
    if mids:
        sel = "+".join(f"between(t\\,{m - 0.02:.2f}\\,{m + 0.06:.2f})" for m in mids)
        cols = 8
        rows = math.ceil(len(mids) / cols)
        dst = proj.p("reference", "sheet_shots.jpg")
        run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(path), "-vf",
                  f"select='{sel}',scale=200:-2,drawtext={drawtext_font()}text='%{{pts\\:hms}}':x=3:y=3:fontsize=12:fontcolor=white:"
                  f"box=1:boxcolor=black@0.6,tile={cols}x{rows}", "-frames:v", "1", "-fps_mode", "passthrough",
                  str(dst)], project_root=proj.root, label="ref_sheet_shots", timeout=600)
        out.append(str(dst.relative_to(proj.root)))
    step = max(1.0, duration / 64)
    dst = proj.p("reference", "sheet_1fps.jpg")
    run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(path), "-vf",
              f"fps=1/{step:.3f},scale=200:-2,drawtext={drawtext_font()}text='%{{pts\\:hms}}':x=3:y=3:fontsize=12:fontcolor=white:"
              f"box=1:boxcolor=black@0.6,tile=8x8", "-frames:v", "1", str(dst)],
             project_root=proj.root, label="ref_sheet_1fps", timeout=600)
    out.append(str(dst.relative_to(proj.root)))
    return out


def loudness(proj: Project, path: Path) -> dict:
    res = run_tool([ffmpeg_path(), "-v", "info", "-nostdin", "-i", str(path), "-vn", "-af", "ebur128=peak=true",
                    "-f", "null", "-"], project_root=proj.root, label="ref_loudness", timeout=600)
    txt = res.stderr
    i = re.findall(r"I:\s+(-?[0-9.]+) LUFS", txt)
    lra = re.findall(r"LRA:\s+(-?[0-9.]+) LU", txt)
    tp = re.findall(r"Peak:\s+(-?[0-9.]+) dBFS", txt)
    return {"integrated_lufs": float(i[-1]) if i else None, "lra_lu": float(lra[-1]) if lra else None,
            "true_peak_db": float(tp[-1]) if tp else None}


def derive_params(dur: float, spans: list[tuple[float, float]], details: list[dict], beat: float | None,
                  cuts: list[float], flash_t: list[float]) -> dict:
    lens = np.array([b - a for a, b in spans]) if spans else np.array([dur])
    first3 = [s for s in spans if s[0] < 3.0]
    on_beat = None
    if beat and cuts:
        phase = [min((t % beat), beat - (t % beat)) for t in cuts]
        on_beat = round(float(np.mean([p < 0.12 for p in phase])), 2)
    kinds = [k for d in details for k in d["camera"]["kind"]]
    def share(k):
        return round(kinds.count(k) / max(len(details), 1), 2)
    bright = float(np.mean([d["look"]["brightness"] for d in details])) if details else 0.45
    contrast = float(np.mean([d["look"]["contrast"] for d in details])) if details else 0.2
    colour = float(np.mean([d["look"]["colourfulness"] for d in details])) if details else 0.2
    look = ("dark_moody" if bright < 0.32 else "bright_clean" if bright > 0.55 else "neutral")
    if contrast > 0.26 and colour > 0.25:
        look = "punchy"
    pacing = "fast" if np.median(lens) < 1.2 else "medium" if np.median(lens) < 2.5 else "slow"
    return {
        "shot_len_median_s": round(float(np.median(lens)), 2),
        "shot_len_mean_s": round(float(lens.mean()), 2),
        "shot_len_min_s": round(float(lens.min()), 2),
        "shot_len_max_s": round(float(lens.max()), 2),
        "cuts_per_10s": round(len(cuts) / max(dur, 1) * 10, 2),
        "hook_shots_in_first_3s": len(first3),
        "hook_first_shot_s": round(float(spans[0][1] - spans[0][0]), 2) if spans else None,
        "pacing": pacing,
        "beat_interval_s": round(beat, 3) if beat else None,
        "cuts_on_beat_ratio": on_beat,
        "cut_to_beat": bool(on_beat is not None and on_beat >= 0.5),
        "flash_transitions": len(flash_t),
        "camera_moves": {"static": share("static"), "push_in": share("push_in"), "pull_out": share("pull_out"),
                         "pan": round(share("move_left") + share("move_right"), 2)},
        "punch_in_zooms": share("push_in") >= 0.25,
        "look": look, "brightness": round(bright, 3), "contrast": round(contrast, 3), "colourfulness": round(colour, 3),
    }


def analyze_reference(proj: Project, src: str) -> dict:
    path = fetch(proj, src)
    h = file_hash(path)
    fp = fingerprint(REF_VERSION, h)
    with stage(proj, "reference", fp) as ctx:
        if ctx["skip"]:
            return read_json(proj.root / "reference" / "breakdown.json")
        info = probe(path)
        proxy = proj.p("reference", "ref_proxy.mp4")
        run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(path), "-vf",
                  "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',fps=30,format=yuv420p",
                  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "15", "-c:a", "aac", "-ar", "48000",
                  str(proxy)], project_root=proj.root, label="ref_proxy", timeout=1800, cancel_check=proj.cancelled)
        dur = probe(proxy).duration
        cuts = detect_shots(proj, proxy)
        bounds = [0.0] + cuts + [dur]
        spans = [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1) if bounds[i + 1] - bounds[i] > 0.05]
        details = shot_details(proxy, spans)
        flash_t = flashes(proxy, dur)
        beat = estimate_beat_interval(proxy) if info.has_audio else None
        rms = read_audio_rms(proxy, window_s=0.5) if info.has_audio else []
        loud = loudness(proj, proxy) if info.has_audio else {}
        sh = sheets(proj, proxy, spans, dur)
        params = derive_params(dur, spans, details, beat, cuts, flash_t)
        # coarse structure: split into thirds and report cut density + energy per third
        thirds = []
        for k in range(3):
            a, b = dur * k / 3, dur * (k + 1) / 3
            n = sum(1 for t in cuts if a <= t < b)
            e = [r.rms_db for r in rms if a <= r.t < b]
            thirds.append({"from": round(a, 1), "to": round(b, 1), "cuts": n,
                           "audio_db": round(float(np.mean(e)), 1) if e else None})
        doc = {
            "version": REF_VERSION, "source": str(src), "hash": h,
            "video": {"duration": round(dur, 2), "width": info.width, "height": info.height, "fps": info.fps_float,
                      "orientation": "vertical" if info.is_vertical else "landscape"},
            "shots": [{"n": i + 1, "start": round(a, 2), "end": round(b, 2), "len": round(b - a, 2)}
                      for i, (a, b) in enumerate(spans)],
            "shot_details": details,
            "transitions": {"cuts": len(cuts), "flash_frames": flash_t},
            "structure_thirds": thirds,
            "audio": {"has_audio": info.has_audio, **loud, "beat_interval_s": beat},
            "evidence": sh,
            "params": params,
            "not_measured": ["typography / on-screen text", "music genre and mood", "sound design details",
                             "dissolve vs hard-cut distinction (all scdet boundaries are counted as cuts)"],
            "policy": "Learn techniques only. Never reuse the reference's footage, music, logos or graphics.",
        }
        out = write_json(proj.p("reference", "breakdown.json"), doc)
        proj.state["reference"] = {"source": str(src), "hash": h}
        proj.save()
        proj.invalidate_from("plan")
        ctx["outputs"] = [str(out.relative_to(proj.root))] + sh
        LOG.info("reference: %d shots, median %.2fs, pacing %s", len(spans), params["shot_len_median_s"], params["pacing"])
        return doc
