"""Stage 2 - understand the footage.

Coarse pass (existing bjj_pipeline heuristics, 4 fps): motion, camera shake,
focus, exposure, audio loudness -> candidate events -> quality scores.

Dense pass (new): around every promising candidate the proxy is re-decoded at
12 fps and the *moving region* is tracked frame by frame (camera shake is
compensated first).  This gives
  * a refined peak moment,
  * a subject track (centre + horizontal extent of the movement) used by the
    vertical reframer to keep BOTH athletes in frame,
  * an honest "fits in 9:16?" verdict.

Scores are kept separate:
  technical  - focus, blur, stability, lighting (can this shot be shown?)
  editorial  - action energy, reaction audio, narrative prior, length fit
and each candidate gets plain-language reasons.  Labels such as "takedown" are
*suggestions*: no athlete, technique, score or winner is ever asserted from
these signals.  The coarse pass samples 4 frames/s, so a candidate is a
pointer to "something happens here", not proof of what happened.
"""
from __future__ import annotations

import math
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from ..analyze import (AudioMetrics, ClipAnalysis, Event, FrameMetrics, HeuristicDetector, aggregate_per_second,
                       analyze_clip, phase_shift, summarize)
from ..media import probe
from ..quality import load_weights, rank
from ..util import LOG, ffmpeg_path, read_json, to_jsonable, write_json
from .jobs import Cancelled, stage
from .project import Project, fingerprint

ANALYSIS_VERSION = "studio-analysis-v3"   # bump whenever analysis code changes -> cache invalidates
DENSE_FPS = 12
DENSE_W = 320

CATEGORY = {
    "action_peak": "action",
    "celebration_candidate": "celebration_or_reaction",
    "crowd_reaction": "crowd_or_coach_reaction",
    "low_activity": "entrance_bench_or_broll",
    "whole_clip": "broll",
    "photo": "photo",
}


# --------------------------------------------------------------------------- coarse

def _load_analysis(d: dict) -> ClipAnalysis:
    from ..media import MediaInfo
    m = MediaInfo(**d["media"])
    return ClipAnalysis(media=m, frames=[FrameMetrics(**f) for f in d.get("frames", [])],
                        audio=[AudioMetrics(**a) for a in d.get("audio", [])],
                        events=[Event(**e) for e in d["events"]], per_second=d["per_second"], summary=d["summary"])


def coarse(proj: Project, asset: dict) -> ClipAnalysis:
    cache = proj.p("cache", "analysis", f"{asset['id']}.json")
    key = fingerprint(ANALYSIS_VERSION, asset["hash"])
    if cache.exists():
        d = read_json(cache)
        if d.get("key") == key:
            return _load_analysis(d)
    an = analyze_clip(proj.root / asset["proxy"], detectors=[HeuristicDetector()])
    an.media.filename = asset["id"]          # segments refer to assets by id
    for e in an.events:
        e.clip = asset["id"]
    d = to_jsonable(an)
    d["key"] = key
    d["frames"] = []                           # per-frame data is not needed later; keep cache small
    d["audio"] = []
    write_json(cache, d)
    return an


# --------------------------------------------------------------------------- dense

def _gray_window(path: Path, start: float, end: float, fps: int = DENSE_FPS, width: int = DENSE_W):
    info = probe(path)
    h = max(2, int(round(width * info.height / max(info.width, 1) / 2)) * 2)
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-ss", f"{start:.3f}", "-i", str(path), "-t", f"{end - start:.3f}",
           "-vf", f"fps={fps},scale={width}:{h}:flags=area,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    res = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    buf = np.frombuffer(res.stdout, dtype=np.uint8)
    n = buf.size // (width * h)
    return buf[: n * width * h].reshape(n, h, width), h


def _shift_xy(prev: np.ndarray, cur: np.ndarray) -> tuple[int, int]:
    """Integer global translation (dx, dy) of cur relative to prev (phase correlation, full res of the window)."""
    a = prev.astype(np.float32) - prev.mean()
    b = cur.astype(np.float32) - cur.mean()
    cross = np.fft.fft2(a) * np.conj(np.fft.fft2(b))
    cross /= np.abs(cross) + 1e-6
    corr = np.abs(np.fft.ifft2(cross))
    py, px = np.unravel_index(int(np.argmax(corr)), corr.shape)
    H, W = a.shape
    dy = py if py <= H // 2 else py - H
    dx = px if px <= W // 2 else px - W
    return int(dx), int(dy)


def dense_track(path: Path, start: float, end: float) -> dict:
    """Track the moving region between start..end.  Returns normalised (0..1) coordinates."""
    frames, h = _gray_window(path, start, end)
    if len(frames) < 3:
        return {"ok": False, "reason": "too few frames decoded"}
    W = frames.shape[2]
    track = []
    energies = []
    acc_col = np.zeros(W, dtype=np.float64)
    for i in range(1, len(frames)):
        prev, cur = frames[i - 1], frames[i]
        dx, dy = _shift_xy(prev, cur)
        if abs(dx) < W // 4 and abs(dy) < h // 4:            # compensate handheld drift before differencing
            cur_al = np.roll(np.roll(cur, dx, axis=1), dy, axis=0)
        else:
            cur_al = cur
        diff = np.abs(cur_al.astype(np.int16) - prev.astype(np.int16))
        m = 8
        diff[:m, :] = 0; diff[-m:, :] = 0; diff[:, :m] = 0; diff[:, -m:] = 0   # roll wrap-around edges
        mask = diff > 18
        mass = float(mask.mean())
        energies.append(mass)
        t = start + i / DENSE_FPS
        if mass < 0.002:
            track.append({"t": round(t, 3), "mass": round(mass, 4)})
            continue
        col = mask.sum(axis=0).astype(np.float64)
        acc_col += col
        row = mask.sum(axis=1).astype(np.float64)
        c = np.cumsum(col) / col.sum()
        x0 = float(np.searchsorted(c, 0.05)) / W
        x1 = float(np.searchsorted(c, 0.95)) / W
        cx = float((col * np.arange(W)).sum() / col.sum()) / W
        r = np.cumsum(row) / row.sum()
        y0 = float(np.searchsorted(r, 0.05)) / h
        y1 = float(np.searchsorted(r, 0.95)) / h
        track.append({"t": round(t, 3), "mass": round(mass, 4), "cx": round(cx, 4), "x0": round(x0, 4),
                      "x1": round(x1, 4), "y0": round(y0, 4), "y1": round(y1, 4), "shift": [dx, dy]})
    e = np.array(energies)
    peak_i = int(np.argmax(e)) if e.size else 0
    active = [p for p in track if "cx" in p]
    # Where did movement happen over the WHOLE window?  Per-frame extents only show the parts moving at that
    # instant; the union is what a static crop must contain to keep both athletes in frame.
    if acc_col.sum() > 0:
        c = np.cumsum(acc_col) / acc_col.sum()
        ex0, ex1 = float(np.searchsorted(c, 0.04)) / W, float(np.searchsorted(c, 0.96)) / W
        ecx = float((acc_col * np.arange(W)).sum() / acc_col.sum()) / W
    else:
        ex0, ex1, ecx = 0.0, 1.0, 0.5
    return {"ok": True, "fps": DENSE_FPS, "start": start, "end": end, "peak_t": round(start + (peak_i + 1) / DENSE_FPS, 3),
            "active_ratio": round(len(active) / max(len(track), 1), 3),
            "extent": [round(ex0, 4), round(ex1, 4)], "extent_cx": round(ecx, 4),
            "spread_p80": round(ex1 - ex0, 3), "track": track}


# --------------------------------------------------------------------------- candidates

def _photo_candidate(proj: Project, asset: dict) -> dict:
    return {"id": f"{asset['id']}_photo", "asset": asset["id"], "kind": "photo", "category": "photo",
            "start": 0.0, "end": 0.0, "technical": 70.0, "editorial": 40.0,
            "reasons": ["still photo - usable as an opener/closer or a held beat (Ken Burns)"],
            "suggested_labels": ["podium", "portrait", "team_photo"], "labels_confirmed": False, "flags": [],
            "track": None, "peak_t": 0.0, "fps": 0.0}


def _reasons(seg, track: dict | None) -> list[str]:
    s = seg.scores
    r = []
    if seg.kind == "action_peak":
        r.append(f"sustained high motion energy ({s.action_intensity:.0f}/100) - something is happening on the mat")
    elif seg.kind == "celebration_candidate":
        r.append("loud audio rise right after an action burst - possibly a score/finish reaction (unconfirmed)")
    elif seg.kind == "crowd_reaction":
        r.append("audio spike above the clip's baseline - crowd/coach/referee (unconfirmed)")
    elif seg.kind == "low_activity":
        r.append("calm stretch - candidate for entrance, bench, waiting or establishing B-roll")
    else:
        r.append("no strong events; kept so nothing is silently discarded")
    if s.focus >= 60:
        r.append(f"in focus ({s.focus:.0f})")
    elif s.focus < 35:
        r.append(f"soft focus ({s.focus:.0f}) - use briefly or not at all")
    if s.stability < 40:
        r.append(f"shaky ({s.stability:.0f}) - stabilize or keep short")
    if s.lighting < 40:
        r.append(f"exposure problem ({s.lighting:.0f}) - will be normalised, check skin tones")
    if track and track.get("ok"):
        r.append(f"movement occupies {track['extent'][0]:.0%}-{track['extent'][1]:.0%} of the frame width "
                 f"(active in {track['active_ratio']:.0%} of 12 fps samples; peak at {track['peak_t']:.1f}s)")
    return r


def analyze(proj: Project) -> dict:
    assets = [a for a in proj.assets if a["status"] == "ok"]
    weights = load_weights(Path(__file__).resolve().parents[2].parent / "config" / "scoring.json")
    fp = fingerprint(ANALYSIS_VERSION, sorted(a["hash"] for a in assets), weights)
    with stage(proj, "analyze", fp) as ctx:
        if ctx["skip"]:
            return read_json(proj.root / "cache" / "candidates.json")
        vids = [a for a in assets if a["kind"] == "video"]
        workers = int(proj.state["settings"].get("max_workers", 2))

        def one(a):
            if proj.cancelled():
                raise Cancelled("analyze cancelled", "delete CANCEL and resume")
            return coarse(proj, a)

        with ThreadPoolExecutor(workers) as ex:
            analyses = list(ex.map(one, vids))
        ranked = rank(analyses, weights)
        by_id = {a["id"]: a for a in vids}
        cands: list[dict] = []
        # every candidate gets a movement track (reframing needs it even for calm B-roll); long windows are
        # sampled around their middle (max 8 s) to bound decode time on long recordings
        dense_jobs = list(ranked)

        def dense(seg):
            a = by_id[seg.clip]
            s0, s1 = max(0.0, seg.start), min(a["duration"], seg.end)
            if s1 - s0 > 8.0:
                mid = (s0 + s1) / 2
                s0, s1 = mid - 4.0, mid + 4.0
            return dense_track(proj.root / a["proxy"], s0, s1)

        with ThreadPoolExecutor(workers) as ex:
            tracks = dict(zip([id(s) for s in dense_jobs], ex.map(dense, dense_jobs)))
        for i, seg in enumerate(ranked):
            tr = tracks.get(id(seg))
            sc = seg.scores
            technical = 0.35 * sc.focus + 0.2 * sc.motion_blur + 0.25 * sc.stability + 0.2 * sc.lighting
            length = seg.end - seg.start
            fit = 100.0 if 1.5 <= length <= 12 else 60.0
            editorial = 0.45 * sc.action_intensity + 0.35 * sc.narrative_importance + 0.2 * fit
            if tr and tr.get("ok"):
                editorial = 0.85 * editorial + 15 * min(1.0, tr["active_ratio"] * 1.5)
            cands.append({
                "id": f"{seg.clip}_{i:03d}", "asset": seg.clip, "kind": seg.kind,
                "category": CATEGORY.get(seg.kind, "other"), "start": round(seg.start, 3), "end": round(seg.end, 3),
                "peak_t": tr.get("peak_t") if tr and tr.get("ok") else round((seg.start + seg.end) / 2, 3),
                "technical": round(technical, 1), "editorial": round(editorial, 1),
                "scores": to_jsonable(sc), "confidence": seg.confidence,
                "suggested_labels": seg.labels, "labels_confirmed": False,
                "flags": list(sc.review_flags), "reasons": _reasons(seg, tr),
                "track": tr if tr and tr.get("ok") else None, "fps": seg.fps,
            })
        for a in assets:
            if a["kind"] == "photo":
                cands.append(_photo_candidate(proj, a))
        cands.sort(key=lambda c: -(0.55 * c["editorial"] + 0.45 * c["technical"]))
        doc = {"version": ANALYSIS_VERSION, "candidates": cands,
               "clips": {an.media.filename: an.summary for an in analyses},
               "honesty": ("Candidates come from motion/audio signals sampled at 4 fps (12 fps around peaks). "
                           "They locate moments; they do not identify athletes, techniques, points or winners.")}
        out = write_json(proj.p("cache", "candidates.json"), doc)
        proj.invalidate_from("plan")
        ctx["outputs"] = [str(out.relative_to(proj.root))]
        ctx["extra"] = {"candidates": len(cands)}
        LOG.info("analyze: %d candidates from %d clips", len(cands), len(analyses))
        return doc
