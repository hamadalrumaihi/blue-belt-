"""Stage E - build editable timelines in DaVinci Resolve via the official scripting API.

This talks to Resolve directly (no MCP needed) using Blackmagic's
`DaVinciResolveScript` module / `fusionscript.dll`.  It is the fallback path
for the Claude skills when the MCP server is unavailable, and the path the
launcher uses for health checks.

Rules enforced here
  * never overwrite an existing project: names are suffixed with -2, -3, ...
  * never start a render unless `allow_render=True` is passed explicitly
  * every operation reports what it did and what still needs the GUI

Requirements: DaVinci Resolve running, a project open or creatable, and
Preferences > System > General > "External scripting using" = Local.
External scripting is a Resolve **Studio** feature (Free edition refuses the
connection); we detect and explain, never bypass.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .plan import EditPlan
from .util import LOG, parse_fps, seconds_to_frames

WIN_API = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Blackmagic Design" / "DaVinci Resolve" / "Support" / "Developer" / "Scripting"
WIN_LIB = Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Blackmagic Design" / "DaVinci Resolve" / "fusionscript.dll"
MAC_API = Path("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting")
MAC_LIB = Path("/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so")
LINUX_API = Path("/opt/resolve/Developer/Scripting")
LINUX_LIB = Path("/opt/resolve/libs/Fusion/fusionscript.so")


@dataclass
class ResolveStatus:
    connected: bool
    product: str | None = None
    version: str | None = None
    edition: str | None = None          # Studio | Free | unknown
    current_project: str | None = None
    current_timeline: str | None = None
    page: str | None = None
    api_path: str | None = None
    lib_path: str | None = None
    python: str = sys.version.split()[0]
    error: str | None = None
    hints: list[str] = field(default_factory=list)


def _paths() -> tuple[Path, Path]:
    api = Path(os.environ.get("RESOLVE_SCRIPT_API") or (WIN_API if os.name == "nt" else MAC_API if sys.platform == "darwin" else LINUX_API))
    lib = Path(os.environ.get("RESOLVE_SCRIPT_LIB") or (WIN_LIB if os.name == "nt" else MAC_LIB if sys.platform == "darwin" else LINUX_LIB))
    return api, lib


def load_module() -> Any:
    """Import DaVinciResolveScript, falling back to loading fusionscript directly."""
    api, lib = _paths()
    modules = api / "Modules"
    if modules.exists() and str(modules) not in sys.path:
        sys.path.insert(0, str(modules))
    if os.name == "nt" and lib.parent.exists() and hasattr(os, "add_dll_directory"):
        os.add_dll_directory(str(lib.parent))
    try:
        import DaVinciResolveScript as dvr  # type: ignore
        return dvr
    except ModuleNotFoundError as exc:
        if exc.name == "imp":
            # Older DaVinciResolveScript.py uses the removed `imp` module (Python >= 3.12).
            LOG.debug("DaVinciResolveScript uses `imp`; loading fusionscript directly")
        elif not lib.exists():
            raise
    if not lib.exists():
        raise FileNotFoundError(f"fusionscript library not found at {lib}")
    loader = importlib.machinery.ExtensionFileLoader("fusionscript", str(lib))
    spec = importlib.util.spec_from_loader("fusionscript", loader)
    assert spec is not None
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def connect() -> tuple[Any | None, ResolveStatus]:
    api, lib = _paths()
    st = ResolveStatus(connected=False, api_path=str(api), lib_path=str(lib))
    if not lib.exists():
        st.error = f"Resolve scripting library not found: {lib}"
        st.hints.append("Is DaVinci Resolve installed? Set RESOLVE_SCRIPT_LIB if it lives elsewhere.")
        return None, st
    try:
        dvr = load_module()
    except Exception as exc:  # noqa: BLE001
        st.error = f"cannot load scripting module: {exc}"
        st.hints.append("Use Python 3.10-3.12 for the Resolve venv; check RESOLVE_SCRIPT_API / RESOLVE_SCRIPT_LIB.")
        return None, st
    try:
        resolve = dvr.scriptapp("Resolve")
    except Exception as exc:  # noqa: BLE001
        st.error = f"scriptapp failed: {exc}"
        return None, st
    if resolve is None:
        st.error = "Resolve did not accept the connection (scriptapp returned None)."
        st.hints += [
            "Start DaVinci Resolve and open (or create) a project first.",
            "Preferences > System > General > 'External scripting using' must be 'Local' (Resolve Studio only).",
            "The free edition does not allow external scripting (Blackmagic restriction). Scripts can still run from "
            "Workspace > Scripts inside Resolve, or use the Studio edition.",
        ]
        return None, st
    try:
        st.product = resolve.GetProductName()
        st.version = resolve.GetVersionString()
        st.edition = "Studio" if st.product and "studio" in st.product.lower() else "Free"
        st.page = resolve.GetCurrentPage()
        pm = resolve.GetProjectManager()
        proj = pm.GetCurrentProject() if pm else None
        if proj:
            st.current_project = proj.GetName()
            tl = proj.GetCurrentTimeline()
            st.current_timeline = tl.GetName() if tl else None
        st.connected = True
    except Exception as exc:  # noqa: BLE001
        st.error = f"connected but query failed: {exc}"
    return resolve, st


def status() -> ResolveStatus:
    return connect()[1]


# --- helpers ----------------------------------------------------------------

def unique_project_name(pm: Any, base: str) -> str:
    existing = set(pm.GetProjectListInCurrentFolder() or [])
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


def unique_timeline_name(project: Any, base: str) -> str:
    names = set()
    for i in range(1, int(project.GetTimelineCount() or 0) + 1):
        tl = project.GetTimelineByIndex(i)
        if tl:
            names.add(tl.GetName())
    if base not in names:
        return base
    n = 2
    while f"{base}-{n}" in names:
        n += 1
    return f"{base}-{n}"


def _bin(media_pool: Any, name: str) -> Any:
    root = media_pool.GetRootFolder()
    for sub in root.GetSubFolderList() or []:
        if sub.GetName() == name:
            return sub
    return media_pool.AddSubFolder(root, name) or root


@dataclass
class BuildResult:
    ok: bool
    project: str | None = None
    timeline: str | None = None
    clips_imported: int = 0
    clips_placed: int = 0
    markers_added: int = 0
    titles_added: int = 0
    render_jobs: list[str] = field(default_factory=list)
    manual_steps: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: str | None = None


def build_timeline(plan: EditPlan, *, project_name: str | None = None, timeline_name: str | None = None,
                   edl_path: Path | None = None, bin_name: str = "BJJ_Pipeline", presets: list[dict] | None = None,
                   render_out_dir: str | None = None, allow_render: bool = False, dry_run: bool = False) -> BuildResult:
    """Create/open a project (never overwriting), import media, build a timeline.

    Preferred route: import the CMX3600 EDL (`edl_path`) with
    MediaPool.ImportTimelineFromFile so constant speed changes (M2) and
    dissolves survive.  Fallback: AppendToTimeline per cut (no speed changes;
    markers tell the editor where to retime).
    """
    res = BuildResult(ok=False)
    resolve, st = connect()
    if resolve is None:
        res.error = st.error
        res.manual_steps += st.hints
        return res
    pm = resolve.GetProjectManager()
    fps = parse_fps(plan.timeline_fps)

    # 1. project (never overwrite)
    project = pm.GetCurrentProject()
    if project_name:
        name = unique_project_name(pm, project_name)
        if name != project_name:
            res.warnings.append(f"project '{project_name}' exists; created '{name}' instead")
        if dry_run:
            res.project = name
        else:
            project = pm.CreateProject(name)
            if not project:
                res.error = f"could not create project {name}"
                return res
    if project is None:
        res.error = "no project open and no --project given"
        return res
    res.project = project.GetName()

    if dry_run:
        res.ok = True
        res.timeline = timeline_name or plan.name
        res.manual_steps.append("dry run: nothing was changed in Resolve")
        return res

    # Match the timeline frame rate to the footage BEFORE creating timelines.
    try:
        cur = project.GetSetting("timelineFrameRate")
        want = f"{float(fps):.3f}".rstrip("0").rstrip(".")
        if str(cur) != want:
            if not project.SetSetting("timelineFrameRate", want):
                res.warnings.append(f"could not set project frame rate to {want} (current {cur}); set it in Project Settings > Master Settings")
    except Exception as exc:  # noqa: BLE001
        res.warnings.append(f"frame rate check failed: {exc}")

    # 2. media
    mp = project.GetMediaPool()
    folder = _bin(mp, bin_name)
    mp.SetCurrentFolder(folder)
    existing = {c.GetName(): c for c in (folder.GetClipList() or [])}
    paths = sorted({c.clip_path for c in plan.cuts})
    to_import = [p for p in paths if Path(p).name not in existing]
    if to_import:
        items = mp.ImportMedia(to_import) or []
        res.clips_imported = len(items)
        for it in items:
            existing[it.GetName()] = it
    missing = [p for p in paths if Path(p).name not in existing]
    if missing:
        res.warnings.append(f"{len(missing)} clips failed to import: {missing[:3]}")

    # 3. timeline
    tl_name = unique_timeline_name(project, timeline_name or plan.name)
    timeline = None
    if edl_path and Path(edl_path).exists():
        timeline = mp.ImportTimelineFromFile(str(edl_path), {"timelineName": tl_name, "importSourceClips": False})
        if timeline is None:
            res.warnings.append("EDL import failed; falling back to AppendToTimeline (no speed changes)")
    if timeline is None:
        timeline = mp.CreateEmptyTimeline(tl_name)
        if not timeline:
            res.error = "could not create timeline"
            return res
        project.SetCurrentTimeline(timeline)
        clip_infos = []
        for cut in plan.cuts:
            item = existing.get(Path(cut.clip_path).name)
            if not item:
                continue
            src_fps = parse_fps(item.GetClipProperty("FPS") or plan.timeline_fps)
            clip_infos.append({"mediaPoolItem": item, "startFrame": seconds_to_frames(cut.src_in, src_fps),
                               "endFrame": max(seconds_to_frames(cut.src_in, src_fps) + 1, seconds_to_frames(cut.src_out, src_fps) - 1),
                               "mediaType": 1, "trackIndex": 1})
        placed = mp.AppendToTimeline(clip_infos) or []
        res.clips_placed = len(placed)
        # speed changes cannot be set through the API -> markers
        rec = 0
        for cut, _ in zip(plan.cuts, placed):
            if cut.speed != 1.0:
                timeline.AddMarker(rec, "Yellow", f"Retime {cut.speed:.0%}", cut.speed_note or "apply speed change", 1)
                res.markers_added += 1
            if cut.transition_in != "cut" and cut.order > 1:
                timeline.AddMarker(rec, "Cyan", f"{cut.transition_in}", f"{cut.transition_frames} frames", 1)
                res.markers_added += 1
            rec += seconds_to_frames(cut.record_duration, fps)
        res.manual_steps.append("Speed changes and transitions could not be applied via the API in this mode: follow the yellow/cyan markers.")
    project.SetCurrentTimeline(timeline)
    res.timeline = timeline.GetName()

    # 4. role / review markers + titles
    rec = 0
    start_tc = int(timeline.GetStartFrame() or 0)
    for cut in plan.cuts:
        try:
            note = f"{cut.role}: {', '.join(cut.labels[:3])}" + (f" | {cut.notes}" if cut.notes else "")
            color = {"opening": "Green", "reaction": "Pink", "closing": "Green", "b_roll": "Blue"}.get(cut.role, "Red")
            if timeline.AddMarker(rec, color, cut.role, note[:250], max(1, seconds_to_frames(cut.record_duration, fps))):
                res.markers_added += 1
        except Exception:  # noqa: BLE001
            pass
        if cut.title:
            try:
                timeline.SetCurrentTimecode(_frames_to_tc_simple(start_tc + rec, fps))
                item = timeline.InsertFusionTitleIntoTimeline("Text+")
                if item:
                    res.titles_added += 1
                    comp = item.GetFusionCompByIndex(1)
                    if comp:
                        tool = comp.FindToolByID("TextPlus")
                        if tool:
                            tool.SetInput("StyledText", cut.title)
                else:
                    res.manual_steps.append(f"add a Text+ title '{cut.title}' at {rec} frames")
            except Exception as exc:  # noqa: BLE001
                res.manual_steps.append(f"add a Text+ title '{cut.title}' at frame {rec} (API: {exc})")
        rec += seconds_to_frames(cut.record_duration, fps)

    # 5. render settings (jobs only; rendering needs allow_render)
    for p in presets or []:
        try:
            project.SetCurrentRenderFormatAndCodec(p["format"], p["codec"])
            settings = dict(p["settings"])
            if render_out_dir:
                settings["TargetDir"] = render_out_dir
            project.SetRenderSettings(settings)
            job = project.AddRenderJob()
            if job:
                res.render_jobs.append(str(job))
        except Exception as exc:  # noqa: BLE001
            res.warnings.append(f"render preset {p.get('settings', {}).get('CustomName')}: {exc}")
    if res.render_jobs:
        if allow_render:
            project.StartRendering(res.render_jobs, False)
            res.manual_steps.append("rendering started (explicitly allowed)")
        else:
            res.manual_steps.append("render jobs were queued but NOT started; press Render All in the Deliver page when ready")
    for p in presets or []:
        if p["settings"].get("FormatHeight", 0) > p["settings"].get("FormatWidth", 0):
            res.manual_steps.append("vertical preset queued: make sure the timeline (or a duplicate) is 1080x1920, or use Smart Reframe (Studio)")
    res.ok = True
    return res


def _frames_to_tc_simple(frames: int, fps) -> str:
    nominal = int(round(float(fps)))
    ff = frames % nominal
    s = frames // nominal
    return f"{s // 3600:02d}:{(s // 60) % 60:02d}:{s % 60:02d}:{ff:02d}"


def add_markers_from_csv(csv_path: Path, clip_filter: str | None = None) -> dict:
    """Place event markers on the CURRENT timeline for clips present in it."""
    import csv as _csv
    resolve, st = connect()
    if resolve is None:
        return {"ok": False, "error": st.error, "hints": st.hints}
    project = resolve.GetProjectManager().GetCurrentProject()
    tl = project.GetCurrentTimeline() if project else None
    if not tl:
        return {"ok": False, "error": "no current timeline"}
    added = 0
    items = []
    for t in range(1, int(tl.GetTrackCount("video") or 0) + 1):
        items += tl.GetItemListInTrack("video", t) or []
    by_name = {}
    for it in items:
        try:
            by_name.setdefault(it.GetName(), []).append(it)
        except Exception:  # noqa: BLE001
            continue
    with Path(csv_path).open(newline="", encoding="utf-8") as f:
        for row in _csv.DictReader(f):
            if clip_filter and clip_filter not in row["clip"]:
                continue
            for it in by_name.get(row["clip"], []):
                src_start = int(it.GetLeftOffset() or 0)
                frame = int(row["start_frame"]) - src_start
                if 0 <= frame < int(it.GetDuration() or 0):
                    if it.AddMarker(frame, row.get("color", "Red"), row["kind"], row.get("notes", "")[:250], int(row.get("duration_frames", 1)) or 1):
                        added += 1
    return {"ok": True, "markers_added": added, "timeline": tl.GetName()}


def native_ai_inventory() -> dict:
    """Which Resolve-native AI features the connected edition exposes to scripts."""
    resolve, st = connect()
    out: dict[str, Any] = {"status": st.__dict__}
    if resolve is None:
        return out
    studio = st.edition == "Studio"
    major = 0
    try:
        major = int((st.version or "0").split(".")[0])
    except ValueError:
        pass
    feats = {
        "scene_cut_detection": {"api": "Timeline.DetectSceneCuts", "available": studio and major >= 19, "edition": "Studio"},
        "auto_subtitles": {"api": "Timeline.CreateSubtitlesFromAudio", "available": studio and major >= 18, "edition": "Studio"},
        "smart_reframe": {"api": "TimelineItem.SmartReframe", "available": studio and major >= 19, "edition": "Studio"},
        "magic_mask": {"api": "TimelineItem.CreateMagicMask", "available": studio and major >= 19, "edition": "Studio"},
        "stabilize": {"api": "TimelineItem.Stabilize", "available": major >= 19, "edition": "Free + Studio"},
        "voice_isolation": {"api": "Fairlight track property", "available": studio, "edition": "Studio"},
        "speed_warp": {"api": "RetimeProcess=SpeedWarp (GUI/inspector)", "available": studio, "edition": "Studio"},
        "optical_flow": {"api": "RetimeProcess=OpticalFlow (GUI/inspector)", "available": True, "edition": "Free + Studio"},
        "intellisearch": {"api": "MediaPoolItem.AnalyzeForIntelliSearch (21+)", "available": studio and major >= 21, "edition": "Studio 21"},
        "face_recognition": {"api": "GUI only (Media page > Detect people)", "available": studio, "edition": "Studio"},
        "ai_color_tools": {"api": "GUI only (Color page: Depth Map, Relight, Face Refinement, AI UltraNR)", "available": studio, "edition": "Studio"},
    }
    out["features"] = feats
    return out
