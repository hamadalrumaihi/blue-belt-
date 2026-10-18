"""Orchestration: run / resume the whole vertical slice with checkpoints.

    ingest -> analyze -> [reference] -> plan -> render(draft) -> qc

`resume` re-runs the same sequence; every stage whose fingerprint still matches
is skipped, so it continues from the first stage that is missing, failed,
cancelled or whose inputs changed (new footage, edited brief, new reference).
Final export is a separate, explicit step (`bjj studio export`) because it
reads the original media and takes longer.
"""
from __future__ import annotations

from .footage import analyze
from .ingest import ingest
from .jobs import log_event
from .planner import plan
from .project import Project
from .qc import run_qc
from .reference import analyze_reference
from .render import render


def run(proj: Project, sources: list[str] | None = None, reference: str | None = None, *,
        until: str = "qc") -> dict:
    proj.clear_cancel()
    srcs = list(sources or proj.state.get("sources") or [])
    if not srcs:
        raise ValueError("no footage sources: pass folders/files (they are remembered for resume)")
    log_event(proj.root, kind="run", until=until, sources=srcs, reference=reference)
    result: dict = {}
    result["ingest"] = {k: v for k, v in ingest(proj, srcs).items() if k != "assets"}
    if until == "ingest":
        return result
    result["analyze"] = {"candidates": len(analyze(proj)["candidates"])}
    if until == "analyze":
        return result
    ref = reference or (proj.state.get("reference") or {}).get("source")
    if ref:
        result["reference"] = analyze_reference(proj, ref)["params"]
    if until == "reference":
        return result
    tl = plan(proj)
    result["plan"] = {"timeline_version": tl["version"], "clips": len(tl["clips"])}
    if until == "plan":
        return result
    result["render"] = render(proj, quality="draft")
    if until == "render":
        return result
    q = run_qc(proj)
    result["qc"] = {"counts": q["automated"]["counts"], "report": f"qc/{q['render'].split('/')[-1].rsplit('.', 1)[0]}.json",
                    "sheet": q["evidence"]["sheet"]}
    return result
