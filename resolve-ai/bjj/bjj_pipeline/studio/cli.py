"""`bjj studio ...` sub-commands (registered by bjj_pipeline.cli).

  bjj studio health                                   environment check (JSON)
  bjj studio new NAME --brief brief.json              create a production (prints its folder)
  bjj studio run PROJECT --footage DIR [DIR..] [--reference FILE|URL]
                                                      ingest -> analyze -> [reference] -> plan -> draft -> qc
  bjj studio resume PROJECT                           continue from the last good checkpoint
  bjj studio status PROJECT                           stages, versions, open feedback
  bjj studio feedback PROJECT --at 12.4 [--to 14] "text"   record timestamped feedback
  bjj studio revise PROJECT --ops ops.json [--feedback fb1,fb2] [--proposed]
                                                      apply operations -> new timeline -> draft -> qc -> evidence
  bjj studio render PROJECT [--final]                 (re)render the current timeline
  bjj studio qc PROJECT                               QC the latest render
  bjj studio export PROJECT                           final render from originals + manifest + OTIO/FCPXML/EDL
  bjj studio cancel PROJECT                           ask the running job to stop (safe; resume later)
  bjj studio ui [--port 8765]                         local web interface (127.0.0.1 only)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..util import read_json, to_jsonable


def _p(x) -> None:
    print(json.dumps(to_jsonable(x), indent=2, ensure_ascii=False))


def _proj(path: str):
    from .project import open_project, studio_home
    p = Path(path)
    if not (p / "project.json").exists() and (studio_home() / "projects" / path / "project.json").exists():
        p = studio_home() / "projects" / path
    return open_project(p)


def cmd(a: argparse.Namespace) -> int:
    from . import pipeline, revise as rv
    from .project import Brief, Project
    act = a.action
    if act == "health":
        from .health import check
        rep = check(resolve=not a.no_resolve)
        _p(rep)
        return 0 if rep["ok"] else 1
    if act == "new":
        brief = read_json(Path(a.brief)) if a.brief else {"title": a.name}
        p = Project.create(a.name, Brief.from_dict(brief), Path(a.parent) if a.parent else None)
        _p({"project": str(p.root), "next": f'bjj studio run "{p.root}" --footage <folder>'})
        return 0
    if act == "ui":
        from .ui import serve
        serve(port=a.port, open_browser=not a.no_browser)
        return 0
    p = _proj(a.project)
    if act in ("run", "resume"):
        if a.brief:
            p.set_brief(read_json(Path(a.brief)))
        res = pipeline.run(p, a.footage or None, a.reference, until=a.until)
        _p({"project": str(p.root), **res})
        return 0
    if act == "status":
        st = p.summary()
        st["open_feedback"] = rv.list_feedback(p)
        st["renders"] = p.state.get("renders", [])[-3:]
        st["resume"] = f'bjj studio resume "{p.root}"'
        _p(st)
        return 0
    if act == "feedback":
        _p(rv.add_feedback(p, " ".join(a.text), a.at, a.to))
        return 0
    if act == "revise":
        from .qc import run_qc
        from .render import render
        from .timeline import load
        drafts = [r for r in p.state.get("renders", []) if r["quality"] == "draft"]
        before = run_qc(p, drafts[-1]["file"] if drafts else None)   # compare draft with draft
        ops = read_json(Path(a.ops)) if a.ops else []
        if a.proposed:
            ops += rv.proposed_ops_from_qc(before, load(p))
        if not ops:
            _p({"message": "no operations given and nothing to propose from QC"})
            return 1
        problems = [{"text": o.get("why", ""), "op": o.get("op"), "clip": o.get("clip")} for o in ops if o.get("why")]
        rec = rv.revise(p, ops, problems=problems,
                        feedback_ids=[x for x in (a.feedback or "").split(",") if x], note=a.note or "", force=a.force)
        render(p, quality="draft")
        after = run_qc(p)
        _p(rv.attach_evidence(p, before, after))
        return 0
    if act == "render":
        from .render import render
        _p(render(p, quality="final" if a.final else "draft"))
        return 0
    if act == "qc":
        from .qc import run_qc
        q = run_qc(p)
        _p({"counts": q["automated"]["counts"],
            "not_passing": [c for c in q["automated"]["checks"] if c["status"] != "pass"],
            "sheet": q["evidence"]["sheet"]})
        return 0
    if act == "export":
        from .export import export
        m = export(p, skip_render=a.skip_render)
        _p({"export_dir": str(p.root / "export"), "files": m["files"], "qc": m["qc"]["counts"]})
        return 0
    if act == "cancel":
        p.request_cancel()
        _p({"cancel_requested": str(p.cancel_flag)})
        return 0
    return 2


def add_parser(sp) -> None:
    s = sp.add_parser("studio", help="integrated production workflow (ingest -> edit -> render -> review -> export)")
    s.add_argument("action", choices=["health", "new", "run", "resume", "status", "feedback", "revise", "render",
                                      "qc", "export", "cancel", "ui"])
    s.add_argument("project", nargs="?", help="project folder or name (for `new`: the production name)")
    s.add_argument("text", nargs="*", help="feedback text")
    s.add_argument("--brief", default=None)
    s.add_argument("--parent", default=None, help="where to create the project (default ~/BBM-Studio/projects)")
    s.add_argument("--footage", nargs="*", default=None)
    s.add_argument("--reference", default=None)
    s.add_argument("--until", default="qc", choices=["ingest", "analyze", "reference", "plan", "render", "qc"])
    s.add_argument("--at", type=float, default=None)
    s.add_argument("--to", type=float, default=None)
    s.add_argument("--ops", default=None)
    s.add_argument("--feedback", default=None)
    s.add_argument("--proposed", action="store_true", help="also apply mechanical fixes proposed by QC")
    s.add_argument("--note", default=None)
    s.add_argument("--force", action="store_true")
    s.add_argument("--final", action="store_true")
    s.add_argument("--skip-render", action="store_true")
    s.add_argument("--no-resolve", action="store_true")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--no-browser", action="store_true")
    s.set_defaults(fn=_dispatch)


def _dispatch(a: argparse.Namespace) -> int:
    if a.action == "new":
        a.name = a.project
        if not a.name:
            raise SystemExit("bjj studio new NAME --brief brief.json")
    elif a.action not in ("health", "ui") and not a.project:
        raise SystemExit(f"bjj studio {a.action} PROJECT ...")
    return cmd(a)
