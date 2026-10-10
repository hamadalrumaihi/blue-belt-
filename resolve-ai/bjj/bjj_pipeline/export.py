"""Exports: CMX3600 EDL, CSV cut list, marker CSV, JSON report, SRT notes, contact sheets, sub-clips.

Resolve import notes
--------------------
* EDL: File > Import > Timeline > Pre-Conform EDL.  Resolve matches clips by
  reel name (we write `AX` + `* FROM CLIP NAME:` like Resolve's own export)
  and by source timecode, so the referenced clips must already be in the
  Media Pool.  Our EDLs assume source TC starts at 00:00:00:00 unless the
  probed file carries a start timecode (then we offset).
* M2 lines carry constant speed changes (e.g. 50 % slow motion).  Resolve
  reads them.  Speed *ramps* cannot be expressed in CMX3600: the EDL carries a
  comment and the marker CSV carries an instruction instead.
* Marker CSV: import via the Edit Index / `bjj resolve markers` (scripting API).
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from .analyze import ClipAnalysis
from .media import MediaInfo
from .plan import EditPlan
from .quality import RankedSegment
from .util import LOG, ffmpeg_path, frames_to_tc, is_drop_frame, parse_fps, run, safe_name, seconds_to_frames, write_json


def _tc_to_frames(tc: str, fps: Fraction) -> int:
    """HH:MM:SS:FF -> frames (nominal-rate counting, matches Resolve EDL display)."""
    parts = tc.replace(";", ":").split(":")
    if len(parts) != 4:
        return 0
    hh, mm, ss, ff = (int(p) for p in parts)
    nominal = int(round(float(fps)))
    return ((hh * 3600 + mm * 60 + ss) * nominal) + ff


def _source_offset_frames(media: MediaInfo | None, fps: Fraction) -> int:
    if media and media.start_timecode:
        try:
            return _tc_to_frames(media.start_timecode, fps)
        except ValueError:
            return 0
    return 0


def write_edl(plan: EditPlan, path: Path, media_by_name: dict[str, MediaInfo] | None = None, title: str | None = None) -> Path:
    fps = parse_fps(plan.timeline_fps)
    df = is_drop_frame(fps)
    lines = [f"TITLE: {title or plan.name}", f"FCM: {'DROP FRAME' if df else 'NON-DROP FRAME'}", ""]
    rec = 0
    for i, cut in enumerate(plan.cuts, start=1):
        media = (media_by_name or {}).get(cut.clip)
        src_fps = parse_fps(media.fps) if media else fps
        off = _source_offset_frames(media, src_fps)
        s_in = off + seconds_to_frames(cut.src_in, src_fps)
        s_out = off + seconds_to_frames(cut.src_out, src_fps)
        rec_len = seconds_to_frames(cut.record_duration, fps)
        r_in, r_out = rec, rec + rec_len
        num = f"{i:03d}"
        trans = "C"
        tframes = ""
        if cut.transition_in != "cut" and cut.transition_frames > 0 and i > 1:
            trans = "D"
            tframes = f"{cut.transition_frames:03d}"
        # Source TC is written at the source's own frame rate (Resolve conforms it),
        # record TC at timeline rate.
        lines.append(
            f"{num}  AX       V     {trans:<4}{tframes:<4}"
            f"{frames_to_tc(s_in, src_fps)} {frames_to_tc(s_out, src_fps)} "
            f"{frames_to_tc(r_in, fps, df)} {frames_to_tc(r_out, fps, df)}"
        )
        if cut.speed != 1.0:
            # M2 motion effect: reel, speed in fps (positive forward), source TC
            lines.append(f"M2   AX       {float(src_fps) * cut.speed:06.1f}                {frames_to_tc(s_in, src_fps)}")
        lines.append(f"* FROM CLIP NAME: {cut.clip}")
        if cut.title:
            lines.append(f"* TITLE: {cut.title}")
        if cut.speed_note:
            lines.append(f"* SPEED: {cut.speed_note}")
        comment = f"{cut.role} | {','.join(cut.labels[:3])} | score {cut.score:.0f}"
        if cut.notes:
            comment += f" | {cut.notes}"
        lines.append(f"* COMMENT: {comment[:200]}")
        lines.append("")
        rec = r_out
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="ascii", errors="replace")
    LOG.info("EDL -> %s (%d events, %s)", path, len(plan.cuts), frames_to_tc(rec, fps, df))
    return path


def write_cutlist_csv(plan: EditPlan, path: Path) -> Path:
    fps = parse_fps(plan.timeline_fps)
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = 0.0
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["order", "role", "clip", "clip_path", "src_in_s", "src_out_s", "src_in_tc", "src_out_tc",
                    "rec_in_tc", "rec_out_tc", "speed", "transition_in", "transition_frames", "title", "labels",
                    "score", "speed_note", "notes"])
        for c in plan.cuts:
            r_in = rec
            rec += c.record_duration
            w.writerow([c.order, c.role, c.clip, c.clip_path, f"{c.src_in:.3f}", f"{c.src_out:.3f}",
                        frames_to_tc(seconds_to_frames(c.src_in, fps), fps), frames_to_tc(seconds_to_frames(c.src_out, fps), fps),
                        frames_to_tc(seconds_to_frames(r_in, fps), fps), frames_to_tc(seconds_to_frames(rec, fps), fps),
                        c.speed, c.transition_in, c.transition_frames, c.title or "", "|".join(c.labels),
                        f"{c.score:.1f}", c.speed_note, c.notes])
    return path


def write_markers_csv(analyses: list[ClipAnalysis], path: Path) -> Path:
    """One row per candidate event with frame numbers, for `bjj resolve markers`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    colors = {"action_peak": "Red", "celebration_candidate": "Yellow", "crowd_reaction": "Green",
              "low_activity": "Blue", "scene_cut": "Cyan"}
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["clip", "clip_path", "start_s", "end_s", "start_frame", "duration_frames", "kind", "color",
                    "confidence", "score", "suggested_labels", "needs_review", "source", "notes"])
        for an in analyses:
            fps = an.media.fps_fraction
            for ev in an.events:
                sf = seconds_to_frames(ev.start, fps)
                df = max(1, seconds_to_frames(ev.end, fps) - sf)
                w.writerow([an.media.filename, an.media.path, f"{ev.start:.3f}", f"{ev.end:.3f}", sf, df, ev.kind,
                            colors.get(ev.kind, "Purple"), f"{ev.confidence:.2f}", f"{ev.score:.2f}",
                            "|".join(ev.suggested_labels), ev.needs_review, ev.source, ev.notes])
    return path


def write_review_csv(ranked: list[RankedSegment], path: Path) -> Path:
    """Human review sheet: editor fills `label` and `keep`, then `bjj plan --review` honours it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["rank", "clip", "start_s", "end_s", "kind", "confidence", "total", "focus", "stability",
                    "lighting", "action", "review_flags", "suggested_labels", "label", "keep", "narrative_1to5", "comment"])
        for i, r in enumerate(ranked, start=1):
            s = r.scores
            w.writerow([i, r.clip, f"{r.start:.2f}", f"{r.end:.2f}", r.kind, f"{r.confidence:.2f}", f"{s.total:.1f}",
                        f"{s.focus:.0f}", f"{s.stability:.0f}", f"{s.lighting:.0f}", f"{s.action_intensity:.0f}",
                        "|".join(s.review_flags), "|".join(r.labels), "", "", "", ""])
    return path


def read_review_csv(path: Path) -> dict[tuple[str, float, float], dict]:
    out: dict[tuple[str, float, float], dict] = {}
    with Path(path).open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = (row["clip"], round(float(row["start_s"]), 2), round(float(row["end_s"]), 2))
            out[key] = row
    return out


def apply_review(ranked: list[RankedSegment], review: dict[tuple[str, float, float], dict]) -> list[RankedSegment]:
    """Apply editor decisions: drop `keep=no`, set label, scale narrative importance."""
    kept: list[RankedSegment] = []
    for r in ranked:
        row = review.get((r.clip, round(r.start, 2), round(r.end, 2)))
        if row:
            if row.get("keep", "").strip().lower() in ("n", "no", "0", "false", "drop"):
                continue
            if row.get("label", "").strip():
                r.labels = [row["label"].strip()] + [l for l in r.labels if l != row["label"].strip()]
                r.needs_review = False
            if row.get("narrative_1to5", "").strip():
                try:
                    n = int(row["narrative_1to5"])
                    r.scores.narrative_importance = {1: 10, 2: 30, 3: 50, 4: 75, 5: 95}.get(n, 50)
                except ValueError:
                    pass
        kept.append(r)
    kept.sort(key=lambda x: x.scores.total, reverse=True)
    return kept


def write_report(analyses: list[ClipAnalysis], ranked: list[RankedSegment], plans: list[EditPlan], path: Path, extra: dict | None = None) -> Path:
    report = {
        "generated_by": "bjj-pipeline",
        "clips": [{"media": an.media, "summary": an.summary, "events": an.events} for an in analyses],
        "ranked_segments": ranked,
        "plans": plans,
        "disclaimer": ("Event kinds are heuristic candidates (motion/audio/scene signals). Suggested labels are a "
                       "review vocabulary, not detections. Confidence is capped at 0.70 for heuristics."),
    }
    if extra:
        report.update(extra)
    return write_json(path, report)


def contact_sheet(media: MediaInfo, out: Path, columns: int = 6, rows: int = 5, width: int = 320) -> Path:
    """Tiled thumbnails across the whole clip with burnt-in timecode."""
    n = columns * rows
    interval = max(media.duration / n, 0.1)
    out.parent.mkdir(parents=True, exist_ok=True)
    vf = (f"fps=1/{interval:.4f},scale={width}:-2,"
          f"drawtext=text='%{{pts\\:hms}}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5,"
          f"tile={columns}x{rows}")
    cmd = [ffmpeg_path(), "-v", "error", "-y", "-nostdin", "-i", media.path, "-vf", vf, "-frames:v", "1", str(out)]
    try:
        run(cmd, timeout=600)
    except Exception as exc:  # drawtext needs libfreetype; fall back without timecode burn-in
        LOG.warning("contact sheet with timecode failed (%s); retrying without text", exc)
        vf = f"fps=1/{interval:.4f},scale={width}:-2,tile={columns}x{rows}"
        run([ffmpeg_path(), "-v", "error", "-y", "-nostdin", "-i", media.path, "-vf", vf, "-frames:v", "1", str(out)], timeout=600)
    return out


def event_sheet(an: ClipAnalysis, out: Path, width: int = 320) -> Path | None:
    """One thumbnail per candidate event, tiled; empty when there are no events."""
    evs = [e for e in an.events if e.kind != "scene_cut"]
    if not evs:
        return None
    sel = "+".join(f"eq(n\\,{int(round(((e.start + e.end) / 2) * an.media.fps_float))})" for e in evs[:30])
    cols = min(6, len(evs))
    rows = (min(len(evs), 30) + cols - 1) // cols
    vf = f"select='{sel}',scale={width}:-2,tile={cols}x{rows}"
    out.parent.mkdir(parents=True, exist_ok=True)
    run([ffmpeg_path(), "-v", "error", "-y", "-nostdin", "-i", an.media.path, "-vf", vf, "-vsync", "vfr", "-frames:v", "1", str(out)], timeout=600)
    return out


def export_subclips(plan: EditPlan, out_dir: Path, reencode: bool = False) -> list[Path]:
    """Write each cut as its own file into 02_Selected-style folder. Originals untouched.

    Stream copy by default (frame-accurate only at keyframes); `reencode=True`
    gives exact cuts in ProRes-like quality using libx264 CRF 14.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for c in plan.cuts:
        stem = f"{c.order:02d}_{safe_name(Path(c.clip).stem)}_{c.src_in:.1f}-{c.src_out:.1f}s"
        dst = out_dir / f"{stem}.mp4"
        if dst.exists():
            LOG.info("subclip exists, skipping: %s", dst.name)
            written.append(dst)
            continue
        cmd = [ffmpeg_path(), "-v", "error", "-y", "-nostdin", "-ss", f"{c.src_in:.3f}", "-to", f"{c.src_out:.3f}", "-i", c.clip_path]
        if reencode:
            cmd += ["-c:v", "libx264", "-crf", "14", "-preset", "medium", "-c:a", "aac", "-b:a", "256k"]
        else:
            cmd += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
        cmd += [str(dst)]
        run(cmd, timeout=1800)
        written.append(dst)
    return written


@dataclass
class ExportBundle:
    edl: Path
    csv: Path
    json: Path
