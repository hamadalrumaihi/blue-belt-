"""`bjj` command line.

  bjj doctor                         tool + Resolve connectivity report (JSON)
  bjj probe <files|dir>              media properties (frame rate, size, timecode)
  bjj organize <src> ...             Stage A
  bjj analyze <files|dir> --out D    Stage B  (+ --hypecut, --contact-sheets)
  bjj rank --analysis D [...]        Stage C  (writes review.csv to fill in)
  bjj plan --analysis D --template T Stage D  (EDL + CSV + JSON)
  bjj subclips --plan P --out D      copy selected ranges to 02_Selected
  bjj presets [--timeline-fps ...]   Stage F render settings (JSON)
  bjj issues --analysis D            /bjj-cleanup: blur / shake / exposure report
  bjj color --analysis D             /bjj-color: grouping + exposure offsets + steps
  bjj resolve status|build|markers|ai  Stage E via the scripting API
  bjj adapters hypecut-markers|vae-plan|vae-srt
  bjj studio health|new|run|resume|status|feedback|revise|render|qc|export|cancel|ui
                                     integrated production workflow (see bjj_pipeline/studio, docs/STUDIO.md)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .util import LOG, iter_media, read_json, setup_logging, to_jsonable, which, write_json


def _p(x: object) -> None:
    print(json.dumps(to_jsonable(x), indent=2, ensure_ascii=False))


# ---------------------------------------------------------------- commands

def cmd_doctor(a: argparse.Namespace) -> int:
    from .resolve_bridge import status
    import numpy
    out = {
        "bjj_pipeline": __version__,
        "python": sys.version.split()[0],
        "numpy": numpy.__version__,
        "ffmpeg": which("ffmpeg", "BJJ_FFMPEG"),
        "ffprobe": which("ffprobe", "BJJ_FFPROBE"),
        "hypecut": which("hypecut", "BJJ_HYPECUT"),
    }
    try:
        import ultralytics  # type: ignore
        out["ultralytics"] = ultralytics.__version__
    except Exception:  # noqa: BLE001
        out["ultralytics"] = None
    out["resolve"] = status() if not a.no_resolve else "skipped"
    _p(out)
    return 0 if out["ffmpeg"] and out["ffprobe"] else 1


def cmd_probe(a: argparse.Namespace) -> int:
    from .media import dominant_fps, probe
    infos = []
    for src in a.paths:
        for f in iter_media(Path(src)):
            infos.append(probe(f))
    _p({"clips": infos, "suggested_timeline_fps": str(dominant_fps(infos)) if infos else None})
    return 0


def cmd_organize(a: argparse.Namespace) -> int:
    from .organize import OrganizeOptions, organize
    opts = OrganizeOptions(library=Path(a.library), tournament=a.tournament, date=a.date, athlete=a.athlete,
                           match=a.match, camera=a.camera, mode=a.mode, checksum=a.checksum,
                           music=Path(a.music) if a.music else None)
    m = organize(Path(a.source), opts)
    _p({"tournament_dir": m.tournament_dir, "clips": len(m.clips), "skipped": m.skipped, "music": m.music, "mode": m.mode})
    return 0


def _load_analyses(analysis_dir: Path):
    from .analyze import ClipAnalysis, Event, FrameMetrics, AudioMetrics
    from .media import MediaInfo
    data = read_json(analysis_dir / "analysis.json")
    out = []
    for c in data["clips"]:
        media = MediaInfo(**c["media"])
        events = [Event(**e) for e in c["events"]]
        out.append(ClipAnalysis(media=media, frames=[FrameMetrics(**f) for f in c.get("frames", [])],
                                audio=[AudioMetrics(**x) for x in c.get("audio", [])], events=events,
                                per_second=c["per_second"], summary=c["summary"]))
    return out


def cmd_analyze(a: argparse.Namespace) -> int:
    from .analyze import HeuristicDetector, analyze_clip
    from .export import contact_sheet, event_sheet, write_markers_csv
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    detectors = [HeuristicDetector(action_threshold=a.threshold)]
    if a.hypecut:
        from .adapters import HypecutDetector
        detectors.append(HypecutDetector(out / "hypecut", Path(a.hypecut_profile) if a.hypecut_profile else None))
    files = [f for src in a.paths for f in iter_media(Path(src))]
    if not files:
        LOG.error("no video files found in %s", a.paths)
        return 1
    analyses = []
    for f in files:
        an = analyze_clip(f, detectors, sample_fps=a.sample_fps)
        analyses.append(an)
        if a.contact_sheets:
            try:
                contact_sheet(an.media, out / "contact-sheets" / f"{f.stem}_sheet.jpg")
                event_sheet(an, out / "contact-sheets" / f"{f.stem}_events.jpg")
            except Exception as exc:  # noqa: BLE001
                LOG.warning("contact sheet failed for %s: %s", f.name, exc)
    write_json(out / "analysis.json", {"clips": [{"media": an.media, "summary": an.summary, "events": an.events,
                                                  "per_second": an.per_second,
                                                  "frames": an.frames if a.keep_frames else [],
                                                  "audio": an.audio if a.keep_frames else []} for an in analyses]})
    write_markers_csv(analyses, out / "markers.csv")
    # ranking + review sheet right away so a single command gives a reviewable report
    from .quality import load_weights, rank
    from .export import write_review_csv, write_report
    ranked = rank(analyses, load_weights(Path(a.weights) if a.weights else None))
    write_review_csv(ranked, out / "review.csv")
    write_json(out / "ranked.json", ranked)
    write_report(analyses, ranked, [], out / "report.json")
    _write_report_md(analyses, ranked, out / "report.md")
    _p({"analysis_dir": str(out), "clips": len(analyses), "events": sum(len(an.events) for an in analyses),
        "ranked_segments": len(ranked), "needs_review": sum(1 for r in ranked if r.needs_review),
        "files": ["analysis.json", "markers.csv", "review.csv", "ranked.json", "report.json", "report.md"]})
    return 0


def _write_report_md(analyses, ranked, path: Path) -> None:
    lines = ["# BJJ footage analysis report", "",
             "Heuristic candidates only: labels are suggestions for review, not detections.", "",
             "## Clips", "", "| clip | duration | fps | res | sharpness(med) | shake(p90 px) | action peak | events |", "|---|---|---|---|---|---|---|---|"]
    for an in analyses:
        s = an.summary
        lines.append(f"| {an.media.filename} | {s['duration']:.1f}s | {s['fps']:.3g} | {s['resolution']} | {s['sharpness_median']:.0f} | "
                     f"{s['shake_p90_px']:.2f} | {s['action_peak']:.2f} | {sum(s['events'].values())} |")
        for w in s.get("media_warnings", []):
            lines.append(f"|  | WARNING: {w} | | | | | | |")
    lines += ["", "## Top candidate moments", "", "| # | clip | in | out | kind | conf | score | flags | suggested labels |", "|---|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(ranked[:40], start=1):
        lines.append(f"| {i} | {r.clip} | {r.start:.1f} | {r.end:.1f} | {r.kind} | {r.confidence:.2f} | {r.scores.total:.0f} | "
                     f"{', '.join(r.scores.review_flags) or '-'} | {', '.join(r.labels[:4])} |")
    lines += ["", "Fill in `review.csv` (label / keep / narrative_1to5) and run `bjj plan --review review.csv`."]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def cmd_rank(a: argparse.Namespace) -> int:
    from .export import apply_review, read_review_csv, write_review_csv
    from .quality import load_weights, rank
    d = Path(a.analysis)
    analyses = _load_analyses(d)
    ranked = rank(analyses, load_weights(Path(a.weights) if a.weights else None))
    if a.review:
        ranked = apply_review(ranked, read_review_csv(Path(a.review)))
    write_json(d / "ranked.json", ranked)
    if not a.review:
        write_review_csv(ranked, d / "review.csv")
    _p({"ranked": len(ranked), "top": [{"clip": r.clip, "in": r.start, "out": r.end, "score": round(r.scores.total, 1),
                                        "flags": r.scores.review_flags} for r in ranked[:10]]})
    return 0


def cmd_plan(a: argparse.Namespace) -> int:
    from .export import apply_review, read_review_csv, write_cutlist_csv, write_edl
    from .media import dominant_fps
    from .plan import build_plan
    from .quality import load_weights, rank
    from .presets import preset
    d = Path(a.analysis)
    analyses = _load_analyses(d)
    ranked = rank(analyses, load_weights(Path(a.weights) if a.weights else None))
    if a.review:
        ranked = apply_review(ranked, read_review_csv(Path(a.review)))
    fps = a.timeline_fps or str(dominant_fps([an.media for an in analyses]))
    athletes = [x.strip() for x in a.athletes.split(",")] if a.athletes else None
    plan = build_plan(a.template, ranked, fps, name=a.name, music=Path(a.music) if a.music else None,
                      athlete=a.athlete, athletes=athletes, include_flagged=a.include_flagged)
    out = Path(a.out) if a.out else d / "plans"
    out.mkdir(parents=True, exist_ok=True)
    stem = out / a.name.replace(" ", "_")
    media_by_name = {an.media.filename: an.media for an in analyses}
    write_json(stem.with_suffix(".plan.json"), plan)
    write_edl(plan, stem.with_suffix(".edl"), media_by_name)
    write_cutlist_csv(plan, stem.with_suffix(".cuts.csv"))
    presets = [preset(k).for_timeline(fps, str(out), a.name) for k in plan.render_presets]
    write_json(stem.with_suffix(".render.json"), presets)
    _p({"plan": str(stem.with_suffix('.plan.json')), "edl": str(stem.with_suffix('.edl')), "cuts": len(plan.cuts),
        "duration_s": round(plan.total_duration, 2), "target": [plan.target_min_s, plan.target_max_s],
        "timeline_fps": plan.timeline_fps, "notes": plan.notes, "render_presets": plan.render_presets})
    return 0


def _load_plan(path: Path):
    from .plan import Cut, EditPlan
    d = read_json(path)
    cuts = [Cut(**c) for c in d.pop("cuts")]
    d.pop("total_duration", None)
    return EditPlan(cuts=cuts, **d)


def cmd_subclips(a: argparse.Namespace) -> int:
    from .export import export_subclips
    plan = _load_plan(Path(a.plan))
    files = export_subclips(plan, Path(a.out), reencode=a.reencode)
    _p({"written": [str(f) for f in files]})
    return 0


def cmd_presets(a: argparse.Namespace) -> int:
    from .presets import PRESETS, describe_all, preset
    if a.list or not a.timeline_fps:
        _p(describe_all())
        return 0
    keys = a.keys or list(PRESETS)
    _p([preset(k).for_timeline(a.timeline_fps, a.out_dir, a.name) for k in keys])
    return 0


def cmd_issues(a: argparse.Namespace) -> int:
    from .quality import load_weights, rank
    analyses = _load_analyses(Path(a.analysis))
    ranked = rank(analyses, load_weights(None))
    rows = []
    for an in analyses:
        s = an.summary
        issues = []
        if s["sharpness_median"] < 40:
            issues.append("soft focus throughout")
        if s["shake_p90_px"] > 3.5:
            issues.append("shaky (consider Stabilize or exclude)")
        if s["clipped_mean"] > 0.03:
            issues.append("blown highlights")
        if s["luma_mean"] < 60:
            issues.append("underexposed")
        if s["luma_mean"] > 190:
            issues.append("overexposed")
        for w in s.get("media_warnings", []):
            issues.append(w)
        rows.append({"clip": an.media.filename, "issues": issues, "sharpness_median": s["sharpness_median"],
                     "shake_p90_px": s["shake_p90_px"], "luma_mean": s["luma_mean"], "clipped_mean": s["clipped_mean"]})
    flagged = [{"clip": r.clip, "in": r.start, "out": r.end, "flags": r.scores.review_flags} for r in ranked if r.scores.review_flags]
    _p({"clips": rows, "flagged_segments": flagged, "note": "Nothing is deleted or excluded automatically."})
    return 0


def cmd_color(a: argparse.Namespace) -> int:
    from .color import color_plan
    analyses = _load_analyses(Path(a.analysis))
    plan = color_plan(analyses, a.target_luma)
    if a.out:
        write_json(Path(a.out), plan)
    _p(plan)
    return 0


def cmd_resolve(a: argparse.Namespace) -> int:
    from . import resolve_bridge as rb
    if a.action == "status":
        _p(rb.status())
        return 0
    if a.action == "ai":
        _p(rb.native_ai_inventory())
        return 0
    if a.action == "markers":
        _p(rb.add_markers_from_csv(Path(a.markers), a.clip))
        return 0
    if a.action == "build":
        from .presets import preset
        plan = _load_plan(Path(a.plan))
        presets = [preset(k).for_timeline(plan.timeline_fps, a.render_dir or str(Path(a.plan).parent), plan.name)
                   for k in (a.presets.split(",") if a.presets else plan.render_presets)] if not a.no_presets else []
        edl = Path(a.plan).with_suffix("").with_suffix(".edl") if Path(a.plan).name.endswith(".plan.json") else None
        res = rb.build_timeline(plan, project_name=a.project, timeline_name=a.timeline, edl_path=edl,
                                presets=presets, render_out_dir=a.render_dir, allow_render=a.allow_render, dry_run=a.dry_run)
        _p(res)
        return 0 if res.ok else 1
    return 2


def cmd_adapters(a: argparse.Namespace) -> int:
    from . import adapters as ad
    if a.action == "hypecut-markers":
        from .analyze import ClipAnalysis
        from .export import write_markers_csv
        from .media import probe
        events = ad.hypecut_events(Path(a.input))
        media = probe(a.source) if a.source else None
        if media is None:
            data = read_json(Path(a.input))
            media = probe(data["source"])
        an = ClipAnalysis(media=media, frames=[], audio=[], events=events, per_second=[], summary={})
        write_markers_csv([an], Path(a.out))
        _p({"events": len(events), "out": a.out})
        return 0
    if a.action == "vae-plan":
        from .export import write_cutlist_csv, write_edl
        plan = ad.video_ad_editor_plan(Path(a.input), Path(a.source) if a.source else None)
        out = Path(a.out)
        write_json(out.with_suffix(".plan.json"), plan)
        write_edl(plan, out.with_suffix(".edl"))
        write_cutlist_csv(plan, out.with_suffix(".cuts.csv"))
        _p({"cuts": len(plan.cuts), "edl": str(out.with_suffix('.edl'))})
        return 0
    if a.action == "vae-srt":
        ad.video_ad_editor_srt(Path(a.input), Path(a.out))
        _p({"srt": a.out})
        return 0
    return 2


# ---------------------------------------------------------------- parser

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="bjj", description="Blue Belt Media BJJ footage pipeline")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--log-file", default=None)
    sp = p.add_subparsers(dest="cmd", required=True)

    s = sp.add_parser("doctor"); s.add_argument("--no-resolve", action="store_true"); s.set_defaults(fn=cmd_doctor)
    s = sp.add_parser("probe"); s.add_argument("paths", nargs="+"); s.set_defaults(fn=cmd_probe)

    s = sp.add_parser("organize")
    s.add_argument("source"); s.add_argument("--library", required=True); s.add_argument("--tournament", required=True)
    s.add_argument("--date", required=True, help="YYYY-MM-DD"); s.add_argument("--athlete", default="_unassigned")
    s.add_argument("--match", default="_unassigned"); s.add_argument("--camera", default="CAM-A")
    s.add_argument("--mode", choices=["copy", "hardlink", "symlink", "dry-run"], default="copy")
    s.add_argument("--checksum", action="store_true"); s.add_argument("--music", default=None)
    s.set_defaults(fn=cmd_organize)

    s = sp.add_parser("analyze")
    s.add_argument("paths", nargs="+"); s.add_argument("--out", required=True)
    s.add_argument("--sample-fps", type=float, default=4.0); s.add_argument("--threshold", type=float, default=0.55)
    s.add_argument("--hypecut", action="store_true", help="also run HypeCut (if installed) and merge its segments")
    s.add_argument("--hypecut-profile", default=None); s.add_argument("--contact-sheets", action="store_true")
    s.add_argument("--keep-frames", action="store_true", help="store per-frame metrics in analysis.json (large)")
    s.add_argument("--weights", default=None)
    s.set_defaults(fn=cmd_analyze)

    s = sp.add_parser("rank"); s.add_argument("--analysis", required=True); s.add_argument("--weights", default=None)
    s.add_argument("--review", default=None); s.set_defaults(fn=cmd_rank)

    s = sp.add_parser("plan")
    s.add_argument("--analysis", required=True); s.add_argument("--template", required=True,
                                                               choices=["cinematic", "high_energy", "full_highlights", "club_recap"])
    s.add_argument("--name", required=True); s.add_argument("--athlete", default=None); s.add_argument("--athletes", default=None)
    s.add_argument("--music", default=None); s.add_argument("--review", default=None); s.add_argument("--weights", default=None)
    s.add_argument("--timeline-fps", default=None, help="override; default = dominant source rate (HFR -> 25/30)")
    s.add_argument("--include-flagged", action="store_true"); s.add_argument("--out", default=None)
    s.set_defaults(fn=cmd_plan)

    s = sp.add_parser("subclips"); s.add_argument("--plan", required=True); s.add_argument("--out", required=True)
    s.add_argument("--reencode", action="store_true"); s.set_defaults(fn=cmd_subclips)

    s = sp.add_parser("presets"); s.add_argument("--list", action="store_true"); s.add_argument("--timeline-fps", default=None)
    s.add_argument("--name", default="export"); s.add_argument("--out-dir", default="."); s.add_argument("--keys", nargs="*")
    s.set_defaults(fn=cmd_presets)

    s = sp.add_parser("issues"); s.add_argument("--analysis", required=True); s.set_defaults(fn=cmd_issues)
    s = sp.add_parser("color"); s.add_argument("--analysis", required=True); s.add_argument("--target-luma", type=float, default=115.0)
    s.add_argument("--out", default=None); s.set_defaults(fn=cmd_color)

    s = sp.add_parser("resolve"); s.add_argument("action", choices=["status", "build", "markers", "ai"])
    s.add_argument("--plan", default=None); s.add_argument("--project", default=None); s.add_argument("--timeline", default=None)
    s.add_argument("--presets", default=None); s.add_argument("--no-presets", action="store_true")
    s.add_argument("--render-dir", default=None); s.add_argument("--allow-render", action="store_true")
    s.add_argument("--dry-run", action="store_true"); s.add_argument("--markers", default=None); s.add_argument("--clip", default=None)
    s.set_defaults(fn=cmd_resolve)

    s = sp.add_parser("adapters"); s.add_argument("action", choices=["hypecut-markers", "vae-plan", "vae-srt"])
    s.add_argument("input"); s.add_argument("--out", required=True); s.add_argument("--source", default=None)
    s.set_defaults(fn=cmd_adapters)

    from .studio.cli import add_parser as add_studio
    add_studio(sp)
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    setup_logging(a.verbose, Path(a.log_file) if a.log_file else None)
    try:
        return int(a.fn(a))
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001
        LOG.error("%s", exc, exc_info=a.verbose)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
