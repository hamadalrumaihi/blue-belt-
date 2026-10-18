"""Stage 5 - quality control of the RENDERED file (never just the plan).

Automated measurements (objective, reproducible) are written to
qc/<render>.json under "automated".  Each check has a status
(pass | warn | fail), the measured value, what was expected, the affected
timestamps (mapped to timeline clips) and evidence files.  There is
deliberately no overall score: a number would hide which problem matters.

Subjective review (pacing, story, brief/reference fit, caption look) is done by
the independent reviewer agent, which looks at the evidence sheets and writes
qc/<render>.review.json with the same timestamped-finding format.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import numpy as np

from ..analyze import read_audio_rms
from ..media import probe
from ..util import LOG, ffmpeg_path, ffprobe_path, parse_fps, read_json, write_json
from .jobs import run_tool, stage
from .project import Project, fingerprint
from .timeline import clip_duration, load, record_layout, validate

QC_VERSION = "qc-v4"


def _check(cid: str, status: str, title: str, value=None, expected=None, at=None, detail: str = "",
           evidence: list[str] | None = None) -> dict:
    return {"id": cid, "status": status, "title": title, "value": value, "expected": expected,
            "timestamps": at or [], "detail": detail, "evidence": evidence or []}


def _intervals(stderr: str, start_key: str, end_key: str) -> list[tuple[float, float]]:
    starts = [float(x) for x in re.findall(start_key + r"[:=]\s*([0-9.]+)", stderr)]
    ends = [float(x) for x in re.findall(end_key + r"[:=]\s*([0-9.]+)", stderr)]
    out = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        out.append((round(s, 2), round(e, 2) if e is not None else None))
    return out


def _clip_label(tl: dict, t: float, to: float | None = None) -> str:
    """Clip id(s) under [t, to]: 'c09' or 'c09-c10' when the span crosses a cut."""
    lay = record_layout(tl)
    end = t if to is None else to
    ids = [tl["clips"][i]["id"] for i, (a, b) in enumerate(lay) if a <= end and b > t + 0.02]
    if not ids:
        ids = [tl["clips"][i]["id"] for i, (a, b) in enumerate(lay) if a <= t <= b][-1:]
    return ids[0] if len(ids) == 1 else (f"{ids[0]}-{ids[-1]}" if ids else "?")


def _expected_still(tl: dict) -> list[tuple[float, float]]:
    """Spans where a frozen picture is intended (photo holds)."""
    return [(a, b) for c, (a, b) in zip(tl["clips"], record_layout(tl)) if c.get("kind") == "photo"]


def _expected_silence(tl: dict, ignore_music: bool = False) -> list[tuple[float, float]]:
    if tl.get("music") and not ignore_music:
        return []
    out = []
    for c, (a, b) in zip(tl["clips"], record_layout(tl)):
        au = c.get("audio", {}) or {}
        if c.get("kind") == "photo" or float(c.get("speed", 1)) < 0.999 or float(au.get("gain_db", 0)) <= -80:
            out.append((a, b))
    return out


def _inside(span: tuple[float, float | None], allowed: list[tuple[float, float]], tol: float = 0.15) -> bool:
    s, e = span
    e = s if e is None else e
    return any(s >= a - tol and e <= b + tol for a, b in allowed)


def motion_at_cuts(path: Path, tl: dict, fps: int = 10) -> list[dict]:
    """Mean |frame diff| just before every cut vs the clip's own median -> 'cut mid-exchange?' evidence."""
    info = probe(path)
    w = 160
    h = max(2, int(round(w * info.height / max(info.width, 1) / 2)) * 2)
    r = subprocess.run([ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), "-vf",
                        f"fps={fps},scale={w}:{h},format=gray", "-f", "rawvideo", "-"], capture_output=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    a = np.frombuffer(r.stdout, np.uint8)
    n = a.size // (w * h)
    if n < 3:
        return []
    fr = a[: n * w * h].reshape(n, h, w).astype(np.int16)
    mot = np.concatenate([[0.0], np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))])
    out = []
    lay = record_layout(tl)
    for i, ((s, e), c) in enumerate(zip(lay, tl["clips"])):
        if i == len(lay) - 1 or c.get("kind") == "photo":
            continue
        i0, i1 = int(s * fps) + 2, int(e * fps) - 1
        if i1 - i0 < 4:
            continue
        seg = mot[i0:i1]
        tail = mot[max(i0, i1 - 3):i1]
        med = float(np.median(seg))
        ratio = float(tail.mean() / med) if med > 0.3 else 0.0
        out.append({"clip": c["id"], "cut_at": round(e, 2), "tail_motion": round(float(tail.mean()), 2),
                    "clip_median": round(med, 2), "ratio": round(ratio, 2), "role": c.get("role")})
    return out


def audio_jumps(path: Path, tl: dict) -> list[dict]:
    rms = read_audio_rms(path, window_s=0.05)
    if not rms:
        return []
    t = np.array([r.t for r in rms])
    db = np.array([r.rms_db for r in rms])
    out = []
    silent = _expected_silence(tl, ignore_music=True)
    for i, (s, e) in enumerate(record_layout(tl)[:-1]):
        tr = (tl["clips"][i + 1].get("transition_in") or {}).get("type", "cut")
        nxt = record_layout(tl)[i + 1]
        if _inside(nxt, silent, tol=0.01) or _inside((s, e), silent, tol=0.01):
            continue            # cut into/out of intended silence (photo hold, muted or slow-motion clip)
        # compare the levels either side of the cut OUTSIDE the short anti-click fades (0.1 s), so a fade is not
        # mistaken for a level step and a level mismatch is not hidden by one
        before = db[(t >= e - 0.45) & (t < e - 0.1)]
        after = db[(t >= e + 0.1) & (t < e + 0.45)]
        if before.size and after.size:
            jump = float(after.mean() - before.mean())
            loud = max(before.mean(), after.mean()) > -40
            out.append({"cut_at": round(e, 2), "jump_db": round(jump, 1), "loud": bool(loud), "transition": tr,
                        "clips": [tl["clips"][i]["id"], tl["clips"][i + 1]["id"]]})
    return out


def evidence_sheet(proj: Project, path: Path, tl: dict, out: Path) -> Path:
    """One frame per clip (mid-point) + the first and last frame of each cut, timestamped."""
    lay = record_layout(tl)
    ts = []
    for (s, e) in lay:
        ts += [round(s + 0.05, 2), round((s + e) / 2, 2), round(max(s, e - 0.08), 2)]
    ts = ts[:72]
    sel = "+".join(f"between(t\\,{x - 0.02:.2f}\\,{x + 0.03:.2f})" for x in ts)
    cols = 9
    rows = max(1, -(-len(ts) // cols))
    run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-i", str(path), "-vf",
              f"select='{sel}',scale=160:-2,drawtext=text='%{{pts\\:hms}}':x=2:y=2:fontsize=11:fontcolor=yellow:"
              f"box=1:boxcolor=black@0.7,tile={cols}x{rows}", "-frames:v", "1", "-fps_mode", "passthrough", str(out)],
             project_root=proj.root, label="qc_sheet", timeout=600)
    return out


def caption_frames(proj: Project, path: Path, tl: dict, out_dir: Path) -> list[str]:
    files = []
    for cap in tl.get("captions", []):
        t = (cap["start"] + cap["end"]) / 2
        f = out_dir / f"caption_{cap['id']}_{t:.2f}s.jpg"
        run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-y", "-ss", f"{t:.3f}", "-i", str(path),
                  "-frames:v", "1", str(f)], project_root=proj.root, label=f"qc_cap_{cap['id']}", timeout=120)
        files.append(str(f.relative_to(proj.root)))
    return files


def run_qc(proj: Project, render_file: str | None = None) -> dict:
    rs = proj.state.get("renders", [])
    if not rs:
        raise FileNotFoundError("nothing rendered yet - run `bjj studio render`")
    entry = next((r for r in rs if r["file"] == render_file), rs[-1]) if render_file else rs[-1]
    path = proj.root / entry["file"]
    tl = load(proj, entry["timeline_version"])
    stem = Path(entry["file"]).stem
    fp = fingerprint(QC_VERSION, entry, path.stat().st_size if path.exists() else 0)
    with stage(proj, "qc", fp) as ctx:
        if ctx["skip"]:
            return read_json(proj.root / "qc" / f"{stem}.json")
        checks: list[dict] = []
        assets = {a["id"]: a for a in proj.assets}
        exp_w, exp_h = (int(x) for x in entry["size"].split("x"))
        exp_fps = float(parse_fps(tl["fps"]))
        exp_dur = record_layout(tl)[-1][1]
        # --- container / stream facts
        info = probe(path)
        checks.append(_check("size", "pass" if (info.width, info.height) == (exp_w, exp_h) else "fail",
                             "frame size / aspect", f"{info.width}x{info.height}", f"{exp_w}x{exp_h}"))
        checks.append(_check("fps", "pass" if abs(info.fps_float - exp_fps) < 0.01 else "fail", "frame rate",
                             round(info.fps_float, 3), round(exp_fps, 3)))
        checks.append(_check("duration", "pass" if abs(info.duration - exp_dur) <= max(0.1, 2 / exp_fps) else "fail",
                             "duration vs timeline", round(info.duration, 3), round(exp_dur, 3)))
        target = proj.brief.target_seconds
        tol = max(1.5, target * 0.1)
        checks.append(_check("brief_length", "pass" if abs(exp_dur - target) <= tol else "warn",
                             "length vs brief", round(exp_dur, 1), f"{target} ±{tol:.1f}"))
        sres = subprocess.run([ffprobe_path(), "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0",
                               str(path)], capture_output=True, text=True)
        durs = {}
        for line in sres.stdout.strip().splitlines():
            parts = line.split(",")
            if len(parts) >= 2 and parts[1] not in ("", "N/A"):
                durs[parts[0]] = float(parts[1])
        if "audio" not in durs:
            checks.append(_check("audio_present", "fail", "audio stream present", "missing", "aac stereo"))
        else:
            d = abs(durs.get("video", 0) - durs["audio"])
            checks.append(_check("av_sync", "pass" if d <= 1.5 / exp_fps + 0.03 else "warn",
                                 "audio/video stream length difference (sync proxy)", round(d, 3),
                                 f"<= {1.5 / exp_fps + 0.03:.3f}s",
                                 detail="segments are rendered with matched A/V lengths; per-clip lip-sync is "
                                        "inherited from the source (there is no dialogue in sports clips)"))
        # --- decode
        dec = run_tool([ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), "-f", "null", "-"],
                       project_root=proj.root, label=f"qc_decode_{stem}", timeout=900)
        errs = [l for l in dec.stderr.splitlines() if l.strip()]
        checks.append(_check("decode", "pass" if not errs else "fail", "full decode without errors", len(errs), 0,
                             detail="; ".join(errs[:3])))
        # --- black / freeze
        bl = run_tool([ffmpeg_path(), "-v", "info", "-nostdin", "-i", str(path), "-an", "-vf",
                       "blackdetect=d=0.2:pic_th=0.95:pix_th=0.08,freezedetect=n=0.002:d=0.6", "-f", "null", "-"],
                      project_root=proj.root, label=f"qc_blackfreeze_{stem}", timeout=900)
        blacks = _intervals(bl.stderr, "black_start", "black_end")
        freezes = _intervals(bl.stderr, "freeze_start", "freeze_end")
        allowed_still = _expected_still(tl)
        bad_black = [b for b in blacks if not (b[0] >= exp_dur - 0.3)]  # a fade-out tail is fine
        bad_freeze = [f for f in freezes if not _inside(f, allowed_still)]
        checks.append(_check("black_frames", "pass" if not bad_black else "fail", "unexpected black frames",
                             len(bad_black), 0, at=[{"t": b[0], "to": b[1], "clip": _clip_label(tl, b[0], b[1])} for b in bad_black]))
        checks.append(_check("frozen_frames", "pass" if not bad_freeze else "warn", "unexpected frozen picture (>0.6 s)",
                             len(bad_freeze), 0, at=[{"t": f[0], "to": f[1], "clip": _clip_label(tl, f[0], f[1])} for f in bad_freeze],
                             detail="photo holds are excluded; a static mat/bench shot can also trigger this"))
        # --- audio: loudness, clipping, silence, abrupt cuts
        lo = run_tool([ffmpeg_path(), "-v", "info", "-nostdin", "-i", str(path), "-vn", "-af",
                       "ebur128=peak=true,volumedetect,silencedetect=noise=-50dB:d=0.5", "-f", "null", "-"],
                      project_root=proj.root, label=f"qc_audio_{stem}", timeout=900)
        txt = lo.stderr
        I = re.findall(r"I:\s+(-?[0-9.]+) LUFS", txt)
        TP = re.findall(r"Peak:\s+(-?[0-9.]+) dBFS", txt)
        mx = re.findall(r"max_volume:\s+(-?[0-9.]+) dB", txt)
        tgt = float(tl.get("audio", {}).get("target_lufs", -14))
        tp_lim = float(tl.get("audio", {}).get("true_peak_db", -1.5))
        lufs = float(I[-1]) if I else None
        tp = float(TP[-1]) if TP else None
        checks.append(_check("loudness", "pass" if lufs is not None and abs(lufs - tgt) <= 1.5 else "warn",
                             "integrated loudness (LUFS)", lufs, f"{tgt} ±1.5",
                             detail="very short or mostly-silent edits cannot always reach the target"))
        checks.append(_check("true_peak", "pass" if tp is not None and tp <= tp_lim + 0.5 else "fail",
                             "true peak (dBTP)", tp, f"<= {tp_lim}"))
        checks.append(_check("clipping", "pass" if mx and float(mx[-1]) < -0.1 else "fail", "sample clipping",
                             float(mx[-1]) if mx else None, "< -0.1 dBFS max"))
        sil = _intervals(txt, "silence_start", "silence_end")
        allowed_sil = _expected_silence(tl)
        bad_sil = [s for s in sil if not _inside(s, allowed_sil, tol=0.3)]
        checks.append(_check("silence", "pass" if not bad_sil else "warn", "unintended silence (< -50 dB, > 0.5 s)",
                             len(bad_sil), 0, at=[{"t": s[0], "to": s[1], "clip": _clip_label(tl, s[0], s[1])} for s in bad_sil],
                             detail="slow-motion / muted clips without music are expected to be silent"))
        jumps = audio_jumps(path, tl)
        abrupt = [j for j in jumps if j["loud"] and abs(j["jump_db"]) >= 15 and j["transition"] == "cut"]
        checks.append(_check("abrupt_audio", "pass" if not abrupt else "warn", "audio level steps at hard cuts (0.1-0.45 s either side)",
                             len(abrupt), "< 15 dB jump",
                             at=[{"t": j["cut_at"], "clip": j["clips"][1], "jump_db": j["jump_db"]} for j in abrupt]))
        # --- editorial mechanics measured on the timeline that produced this render
        issues = validate(tl, assets)
        warn = [i for i in issues if i.level == "warning"]
        checks.append(_check("timeline_warnings", "pass" if not warn else "warn", "timeline validation warnings",
                             len(warn), 0, detail="; ".join(f"{i.where}: {i.message}" for i in warn)[:600]))
        rep = []
        clips = tl["clips"]
        for i in range(len(clips)):
            for j in range(i + 1, len(clips)):
                a, b = clips[i], clips[j]
                if a["asset"] == b["asset"] and a.get("kind") != "photo":
                    ov = min(a["src_out"], b["src_out"]) - max(a["src_in"], b["src_in"])
                    if ov > 0.2:
                        rep.append({"clips": [a["id"], b["id"]], "overlap_s": round(ov, 2),
                                    "t": record_layout(tl)[j][0]})
        index = read_json(proj.root / "cache" / "index.json") if (proj.root / "cache" / "index.json").exists() else {}
        from .planner import event_clock
        clock = event_clock(index)
        lay = record_layout(tl)
        for i in range(len(clips)):
            for j in range(i + 1, len(clips)):
                a, b = clips[i], clips[j]
                if a["asset"] == b["asset"] or a.get("kind") == "photo" or b.get("kind") == "photo":
                    continue
                ga, oa = clock.get(a["asset"], (a["asset"], 0.0))
                gb, ob = clock.get(b["asset"], (b["asset"], 0.0))
                if ga == gb:
                    ov = min(a["src_out"] + oa, b["src_out"] + ob) - max(a["src_in"] + oa, b["src_in"] + ob)
                    if ov > 0.2:
                        rep.append({"clips": [a["id"], b["id"]], "overlap_s": round(ov, 2), "t": lay[j][0],
                                    "note": "same moment from another camera - reads as a new moment unless it is a deliberate replay"})
        checks.append(_check("repeated_shots", "pass" if not rep else "warn", "repeated / same-moment shots",
                             len(rep), 0, at=[{"t": r["t"], "clip": r["clips"][1], **r} for r in rep]))
        lens = [clip_duration(c) for c in clips]
        rp = tl.get("reference_params")
        if rp:
            med = float(np.median(lens))
            ratio = med / max(rp["shot_len_median_s"], 0.1)
            checks.append(_check("pacing_vs_reference", "pass" if 0.6 <= ratio <= 1.7 else "warn",
                                 "median shot length vs reference", round(med, 2), rp["shot_len_median_s"],
                                 detail="sports action is often deliberately held longer than a dance/promo reference"))
        mc = motion_at_cuts(path, tl)
        mid = [m for m in mc if m["ratio"] >= 1.8 and m["tail_motion"] > 4 and m["role"] in ("action", "hook")]
        checks.append(_check("cut_mid_action", "pass" if not mid else "warn", "cuts landing on peak motion (possible interrupted exchange)",
                             len(mid), 0, at=[{"t": m["cut_at"], "clip": m["clip"], "ratio": m["ratio"]} for m in mid],
                             detail="motion just before the cut is well above the clip's median; check the exchange finished"))
        # --- captions (mechanics; looks are judged in review from the caption frames)
        caps = tl.get("captions", [])
        qcdir = proj.p("qc", stem, "x").parent
        cap_files = caption_frames(proj, path, tl, qcdir) if caps else []
        cps = [{"id": c["id"], "cps": round(len(c["text"]) / max(c["end"] - c["start"], 0.01), 1)} for c in caps]
        fast = [c for c in cps if c["cps"] > 17]
        checks.append(_check("caption_timing", "pass" if not fast else "warn", "caption reading speed (chars/s)",
                             cps, "<= 17", at=[{"caption": c["id"]} for c in fast], evidence=cap_files,
                             detail="Arabic shaping/RTL must be confirmed by looking at the caption frames"))
        sheet = evidence_sheet(proj, path, tl, qcdir / "sheet.jpg")
        counts = {s: sum(1 for c in checks if c["status"] == s) for s in ("pass", "warn", "fail")}
        doc = {"version": QC_VERSION, "render": entry["file"], "timeline_version": tl["version"],
               "automated": {"checks": checks, "counts": counts},
               "evidence": {"sheet": str(sheet.relative_to(proj.root)), "caption_frames": cap_files,
                            "motion_at_cuts": mc, "audio_at_cuts": jumps},
               "subjective": "pending - the reviewer agent writes qc/%s.review.json after watching the evidence" % stem,
               "note": "Automated checks prove mechanics, not editorial quality. No overall score is given on purpose."}
        out = write_json(proj.p("qc", f"{stem}.json"), doc)
        ctx["outputs"] = [str(out.relative_to(proj.root))]
        ctx["extra"] = {"counts": counts, "render": entry["file"]}
        LOG.info("qc %s: %s", stem, counts)
        return doc
