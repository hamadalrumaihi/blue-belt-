"""Stage 7 - export: final render from ORIGINAL media + manifest + editable timelines.

export/
  <name>_<format>_v<NNN>.mp4      final video (1080x1920 default, -14 LUFS)
  <name>_v<NNN>.otio              OpenTimelineIO JSON  (Resolve: File > Import > Timeline)
  <name>_v<NNN>.fcpxml            FCPXML 1.9
  <name>_v<NNN>.edl               CMX3600 (existing bjj_pipeline writer)
  <name>_v<NNN>.timeline.json     the authoritative bbm-timeline/1 document
  manifest.json                   sources + hashes, tool versions, settings, QC summary, revision log
"""
from __future__ import annotations

import json
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

from ..export import write_edl
from ..media import probe
from ..util import LOG, ffmpeg_path, read_json, safe_name, write_json
from . import SCHEMA_VERSION
from .project import Project
from .qc import run_qc
from .render import render
from .timeline import load, to_edit_plan, to_fcpxml, to_otio


def tool_versions() -> dict:
    def first_line(cmd):
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.splitlines()[0]
        except Exception:
            return None
    from .. import __version__ as bjj_version
    return {"ffmpeg": first_line([ffmpeg_path(), "-version"]), "python": sys.version.split()[0],
            "platform": platform.platform(), "bjj_pipeline": bjj_version, "studio_schema": SCHEMA_VERSION}


def export(proj: Project, *, quality: str = "final", skip_render: bool = False) -> dict:
    tl = load(proj)
    v = tl["version"]
    if not skip_render:
        render(proj, quality=quality)
    entry = next(r for r in reversed(proj.state["renders"]) if r["timeline_version"] == v and r["quality"] == quality)
    qc = run_qc(proj, entry["file"])
    name = safe_name(tl["name"])
    out = proj.p("export", "x").parent
    video = out / f"{name}_{tl['format']}_v{v:03d}.mp4"
    shutil.copy2(proj.root / entry["file"], video)
    assets = {a["id"]: a for a in proj.assets}
    used = sorted({c["asset"] for c in tl["clips"]})
    files = {"video": video.name}
    otio = out / f"{name}_v{v:03d}.otio"
    otio.write_text(json.dumps(to_otio(tl, assets), indent=2, ensure_ascii=False), encoding="utf-8")
    files["otio"] = otio.name
    fcp = out / f"{name}_v{v:03d}.fcpxml"
    fcp.write_text(to_fcpxml(tl, assets), encoding="utf-8")
    files["fcpxml"] = fcp.name
    try:
        media = {}
        for aid in used:
            a = assets[aid]
            if a["kind"] == "video" and Path(a["source"]).exists():
                media[Path(a["source"]).name] = probe(a["source"])
        edl = write_edl(to_edit_plan(tl, assets), out / f"{name}_v{v:03d}.edl", media_by_name=media)
        files["edl"] = edl.name
    except Exception as exc:          # EDL is a convenience; never fail the export over it
        LOG.warning("EDL export skipped: %s", exc)
    write_json(out / f"{name}_v{v:03d}.timeline.json", tl)
    files["timeline"] = f"{name}_v{v:03d}.timeline.json"
    revs = []
    rp = proj.root / "revisions.jsonl"
    if rp.exists():
        revs = [json.loads(l) for l in rp.read_text(encoding="utf-8").splitlines() if l.strip()]
    manifest = {
        "schema": "bbm-manifest/1", "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "project": proj.state["name"],
        "brief": proj.state["brief"], "timeline_version": v, "files": files,
        "sources": [{"id": a, "path": assets[a]["source"], "hash": assets[a]["hash"], "kind": assets[a]["kind"],
                     "duration": assets[a].get("duration"), "fps": assets[a].get("fps"),
                     "resolution": f"{assets[a].get('width')}x{assets[a].get('height')}"} for a in used],
        "render": entry, "qc": {"counts": qc["automated"]["counts"],
                                "warnings_and_failures": [c for c in qc["automated"]["checks"] if c["status"] != "pass"]},
        "revisions": revs, "tools": tool_versions(),
        "reference": proj.state.get("reference"),
        "notes": tl.get("notes", []),
    }
    write_json(out / "manifest.json", manifest)
    proj.mark("export", "done", outputs=[f"export/{f}" for f in files.values()] + ["export/manifest.json"])
    LOG.info("export -> %s", video)
    return manifest
