"""Stage 6 - revise: timestamped feedback -> structured operations -> new timeline version.

Feedback is recorded first (who/what/when, timestamps on the RENDER being
reviewed).  Each item is mapped to the clip(s) under those timestamps.  The
change itself is a list of explicit operations - never a silent re-plan - so
every revision is reproducible and reviewable:

    trim        {clip, in_delta?, out_delta?}           seconds (+ later / - earlier)
    replace     {clip, candidate?}                      next-best unused moment of the same kind
    remove      {clip}
    move        {clip, to}                              1-based position
    reframe     {clip, mode, x?}
    speed       {clip, speed}
    audio       {clip, gain_db?, fade_in?, fade_out?}
    transition  {clip, type, duration?}
    color       {clip, gamma?, contrast?, saturation?}
    stabilize   {clip, on}
    caption     {caption, text?, start?, end?, position?, lang?}   | {add: {...}} | {remove: id}
    music       {gain_db?, duck_db?, path?}

Only segments whose clip settings changed are re-rendered (segment cache).
The revision log (revisions.jsonl) records: problem, affected timestamps,
change made, and - after the new render + QC - the evidence (before/after
values of the related automated checks and new timestamps).
Review rounds are bounded (settings.max_review_rounds, default 3).
"""
from __future__ import annotations

import copy
import json
import time

from ..util import LOG, read_json, write_json
from .jobs import StudioError, log_event
from .project import Project
from .timeline import clip_at, load, record_layout, save_version, validate

MAX_ROUNDS_DEFAULT = 3


def feedback_path(proj: Project):
    return proj.p("qc", "feedback.jsonl")


def add_feedback(proj: Project, text: str, at: float | None = None, to: float | None = None,
                 source: str = "user", render: str | None = None) -> dict:
    render = render or (proj.state.get("renders") or [{}])[-1].get("file")
    tl = load(proj, (proj.state.get("renders") or [{}])[-1].get("timeline_version"))
    clips = []
    if at is not None:
        lay = record_layout(tl)
        lo, hi = at, (to if to is not None else at)
        for i, (a, b) in enumerate(lay):
            if a <= hi and b > lo:
                clips.append(tl["clips"][i]["id"])
    item = {"id": f"fb{int(time.time() * 1000) % 10_000_000:07d}", "at": at, "to": to, "text": text,
            "source": source, "render": render, "timeline_version": tl["version"], "clips": clips,
            "status": "open", "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with feedback_path(proj).open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")
    log_event(proj.root, kind="feedback", **item)
    return item


def list_feedback(proj: Project, status: str | None = "open") -> list[dict]:
    p = feedback_path(proj)
    if not p.exists():
        return []
    items = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.strip():
            d = json.loads(line)
            items[d["id"]] = {**items.get(d["id"], {}), **d}
    return [i for i in items.values() if status is None or i.get("status") == status]


def _close_feedback(proj: Project, ids: list[str], revision: int) -> None:
    with feedback_path(proj).open("a", encoding="utf-8") as f:
        for i in ids:
            f.write(json.dumps({"id": i, "status": "addressed", "revision": revision}) + "\n")


def _find(tl: dict, cid: str) -> int:
    for i, c in enumerate(tl["clips"]):
        if c["id"] == cid:
            return i
    raise StudioError(f"no clip {cid} in timeline v{tl['version']}", "use the clip ids shown in the review sheet")


def _event_spans(proj: Project, tl: dict, exclude: str) -> tuple[list[tuple[str, float, float]], dict]:
    from .planner import event_clock
    idx = proj.root / "cache" / "index.json"
    clock = event_clock(read_json(idx)) if idx.exists() else {}
    out = []
    for c in tl["clips"]:
        if c["id"] == exclude or c.get("kind") == "photo":
            continue
        g, off = clock.get(c["asset"], (c["asset"], 0.0))
        out.append((g, c["src_in"] + off, c["src_out"] + off))
    return out, clock


def _next_candidate(proj: Project, tl: dict, clip: dict, explicit: str | None, length: float) -> tuple[dict, float, float]:
    """Best unused moment that (a) shows something new - no overlap on the event clock with any other clip,
    (b) is not static or near-black, (c) preferably of the same kind.  Returns (candidate, src_in, src_out)."""
    cdoc = read_json(proj.root / "cache" / "candidates.json")
    cands = cdoc["candidates"]
    summ = cdoc.get("clips", {})
    assets = {a["id"]: a for a in proj.assets if a["status"] == "ok"}
    spans, clock = _event_spans(proj, tl, clip["id"])

    def window(c):
        a = assets[c["asset"]]
        peak = c.get("peak_t") or (c["start"] + c["end"]) / 2
        s0 = max(0.0, max(c["start"], peak - length * 0.55))
        return s0, min(a["duration"] - 0.05, s0 + length)

    def free(c, s0, s1):
        g, off = clock.get(c["asset"], (c["asset"], 0.0))
        return all(not (g == ug and min(s1 + off, u1) - max(s0 + off, u0) > 0.25) for ug, u0, u1 in spans)

    def weak(c):
        return ((summ.get(c["asset"]) or {}).get("luma_mean", 118) < 30 or
                (bool(c.get("track")) and c["track"].get("active_ratio", 1) < 0.05))

    if explicit:
        c = next((x for x in cands if x["id"] == explicit), None)
        if c is None:
            raise StudioError(f"candidate {explicit} not found")
        s0, s1 = window(c)
        return c, s0, s1
    cur = next((c for c in cands if c["id"] == clip.get("candidate")), None)
    cat = cur["category"] if cur else None
    pool = [c for c in cands if c["kind"] != "photo" and c["asset"] in assets]
    pool.sort(key=lambda c: (weak(c), c["category"] != cat, -(0.55 * c["editorial"] + 0.45 * c["technical"])))
    for c in pool:
        # try the candidate's own window, then later windows inside it
        s0, s1 = window(c)
        while s1 <= c["end"] + 0.01 and s1 - s0 >= 0.5:
            if free(c, s0, s1):
                return c, s0, s1
            s0, s1 = s0 + length * 0.5, s1 + length * 0.5
    raise StudioError("no unused moment left that would not repeat something already shown",
                      "ingest more footage, or remove the clip instead")


def apply_ops(proj: Project, tl: dict, ops: list[dict]) -> tuple[dict, list[str]]:
    tl = copy.deepcopy(tl)
    assets = {a["id"]: a for a in proj.assets}
    changed: list[str] = []
    for op in ops:
        kind = op.get("op")
        if kind == "music":
            if tl.get("music") is None and not op.get("path"):
                raise StudioError("timeline has no music to adjust", "pass path= to add a track")
            m = tl.get("music") or {"gain_db": -18.0, "duck_db": 6.0, "fade_in": 0.3, "fade_out": 1.5, "start": 0.0}
            for k in ("gain_db", "duck_db", "path"):
                if k in op:
                    m[k] = op[k]
            tl["music"] = m
            changed.append("music")
            continue
        if kind == "caption":
            caps = tl.setdefault("captions", [])
            if "add" in op:
                new = dict(op["add"])
                new.setdefault("id", f"t{len(caps) + 1}")
                new.setdefault("role", "caption")
                new.setdefault("position", "bottom")
                new.setdefault("lang", "en")
                caps.append(new)
                changed.append(new["id"])
            elif "remove" in op:
                tl["captions"] = [c for c in caps if c["id"] != op["remove"]]
                changed.append(op["remove"])
            else:
                cap = next((c for c in caps if c["id"] == op["caption"]), None)
                if cap is None:
                    raise StudioError(f"no caption {op.get('caption')}")
                for k in ("text", "start", "end", "position", "lang", "role"):
                    if k in op:
                        cap[k] = op[k]
                changed.append(cap["id"])
            continue
        if op.get("source") == "qc" and not any(x["id"] == op.get("clip") for x in tl["clips"]):
            tl.setdefault("notes", []).append(f"QC-proposed {kind} on {op.get('clip')} skipped: clip already removed")
            continue
        i = _find(tl, op["clip"])
        c = tl["clips"][i]
        if kind == "trim":
            c["src_in"] = round(max(0.0, c["src_in"] + float(op.get("in_delta", 0))), 3)
            dur = assets[c["asset"]]["duration"]
            c["src_out"] = round(min(dur - 0.05, c["src_out"] + float(op.get("out_delta", 0))), 3)
        elif kind == "replace":
            length = (c["src_out"] - c["src_in"]) / max(float(c.get("speed", 1.0)), 1e-6)
            try:
                cand, src_in, src_out = _next_candidate(proj, tl, c, op.get("candidate"), length)
            except StudioError as exc:
                if op.get("source") != "qc":
                    raise
                tl.setdefault("notes", []).append(f"QC-proposed replace of {c['id']} skipped: {exc}".split("\n")[0])
                continue
            a = assets[cand["asset"]]
            from .planner import reframe as _reframe
            rf, notes = _reframe(a, cand, tl["width"], tl["height"])
            c.update(asset=cand["asset"], candidate=cand["id"], src_in=round(src_in, 3), src_out=round(src_out, 3),
                     reframe=rf, speed=1.0, stabilize=False,
                     reason=f"replacement ({op.get('why', 'review')}): " + "; ".join(cand.get("reasons", [])[:2]),
                     notes=notes)
        elif kind == "remove":
            tl["clips"].pop(i)
            changed.append(op["clip"])
            continue
        elif kind == "move":
            to = max(1, min(len(tl["clips"]), int(op["to"]))) - 1
            tl["clips"].insert(to, tl["clips"].pop(i))
        elif kind == "reframe":
            rf = c.setdefault("reframe", {})
            rf["mode"] = op["mode"]
            if "x" in op:
                rf["x"] = float(op["x"])
            if op["mode"] == "crop" and "w" not in rf:
                a = assets[c["asset"]]
                rf["w"] = round((tl["width"] / tl["height"]) / (a["width"] / a["height"]), 4)
        elif kind == "speed":
            sp = float(op["speed"])
            src_len = c["src_out"] - c["src_in"]
            rec = src_len / c.get("speed", 1.0)
            c["speed"] = sp
            if op.get("keep_duration", True):          # keep the slot length, change the source length
                c["src_out"] = round(c["src_in"] + rec * sp, 3)
        elif kind == "audio":
            au = c.setdefault("audio", {})
            for k in ("gain_db", "fade_in", "fade_out"):
                if k in op:
                    au[k] = float(op[k])
        elif kind == "transition":
            c["transition_in"] = {"type": op["type"], "duration": float(op.get("duration", 0.3 if op["type"] != "cut" else 0))}
        elif kind == "color":
            col = c.setdefault("color", {})
            for k in ("gamma", "contrast", "saturation"):
                if k in op:
                    col[k] = float(op[k])
        elif kind == "stabilize":
            c["stabilize"] = bool(op.get("on", True))
        else:
            raise StudioError(f"unknown revision op {kind!r}", "see bjj_pipeline/studio/revise.py docstring")
        changed.append(c["id"])
    # re-number nothing: clip ids are stable across versions so feedback stays traceable
    from .timeline import reflow_captions
    tl.setdefault("notes", []).extend(reflow_captions(tl))
    return tl, changed


def revise(proj: Project, ops: list[dict], *, problems: list[dict] | None = None, feedback_ids: list[str] | None = None,
           note: str = "", force: bool = False) -> dict:
    rounds = int(proj.state.get("review_round", 0))
    limit = int(proj.state.get("settings", {}).get("max_review_rounds", MAX_ROUNDS_DEFAULT))
    if rounds >= limit and not force:
        raise StudioError(f"review round limit reached ({rounds}/{limit})",
                          "report the remaining problems honestly, or pass --force to allow another round")
    base = load(proj)
    new, changed = apply_ops(proj, base, ops)
    issues = validate(new, {a["id"]: a for a in proj.assets})
    errs = [i for i in issues if i.level == "error"]
    if errs:
        raise StudioError("revision would make the timeline invalid: " + "; ".join(f"{e.where}: {e.message}" for e in errs),
                          "adjust the operation values")
    fb = [f for f in list_feedback(proj, None) if f["id"] in set(feedback_ids or [])]
    problems = (problems or []) + [{"text": f["text"], "at": f.get("at"), "to": f.get("to"), "clips": f.get("clips"),
                                    "source": f.get("source")} for f in fb]
    path = save_version(proj, new, note or f"revision round {rounds + 1}")
    proj.state["review_round"] = rounds + 1
    proj.save()
    rec = {"round": rounds + 1, "from_version": base["version"], "to_version": proj.state["timeline_version"],
           "problems": problems, "ops": ops, "changed": sorted(set(changed)), "note": note,
           "evidence": None, "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with proj.p("revisions.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    if feedback_ids:
        _close_feedback(proj, feedback_ids, rec["to_version"])
    log_event(proj.root, kind="revision", round=rec["round"], changed=rec["changed"])
    LOG.info("revision %d: %s -> v%03d", rec["round"], rec["changed"], rec["to_version"])
    return rec


def attach_evidence(proj: Project, before_qc: dict, after_qc: dict) -> dict:
    """Fill the last revision's evidence: before/after values of every check whose value or status changed."""
    p = proj.root / "revisions.jsonl"
    lines = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not lines:
        raise StudioError("no revision to attach evidence to")
    last = lines[-1]
    b = {c["id"]: c for c in before_qc["automated"]["checks"]}
    a = {c["id"]: c for c in after_qc["automated"]["checks"]}
    diffs = []
    for k in a:
        if k not in b or b[k]["status"] != a[k]["status"] or b[k]["value"] != a[k]["value"]:
            diffs.append({"check": k, "before": {"status": b.get(k, {}).get("status"), "value": b.get(k, {}).get("value"),
                                                 "timestamps": b.get(k, {}).get("timestamps")},
                          "after": {"status": a[k]["status"], "value": a[k]["value"], "timestamps": a[k]["timestamps"]}})
    tl = load(proj, after_qc["timeline_version"])
    lay = record_layout(tl)
    new_ts = [{"clip": c["id"], "now_at": lay[i][0], "to": lay[i][1]} for i, c in enumerate(tl["clips"])
              if c["id"] in last["changed"]]
    last["evidence"] = {"render_before": before_qc["render"], "render_after": after_qc["render"],
                        "qc_before": before_qc["automated"]["counts"], "qc_after": after_qc["automated"]["counts"],
                        "changed_checks": diffs, "changed_clips_now_at": new_ts,
                        "sheet_after": after_qc["evidence"]["sheet"]}
    lines[-1] = last
    p.write_text("\n".join(json.dumps(l, ensure_ascii=False) for l in lines) + "\n", encoding="utf-8")
    return last


def proposed_ops_from_qc(qc: dict, tl: dict) -> list[dict]:
    """Mechanical fixes the system can propose itself (the reviewer/user still decides editorial ones)."""
    ops = []
    for c in qc["automated"]["checks"]:
        if c["status"] == "pass":
            continue
        if c["id"] == "abrupt_audio":
            # A level step is fixed by matching levels, not by fading (a fade makes the measured step larger).
            # Each cut asks for half the step on each side; requests on the same clip are summed, then capped
            # at +/-6 dB so one revision never swings a clip wildly.  One op per clip.
            delta: dict[str, float] = {}
            whys: dict[str, list[str]] = {}
            idx = {x["id"]: k for k, x in enumerate(tl["clips"])}
            for t in c["timestamps"]:
                i = idx.get(t["clip"])
                if not i:
                    continue
                step = float(t["jump_db"])                   # after - before
                cur, prev = tl["clips"][i]["id"], tl["clips"][i - 1]["id"]
                delta[cur] = delta.get(cur, 0.0) - step / 2
                delta[prev] = delta.get(prev, 0.0) + step / 2
                for k in (cur, prev):
                    whys.setdefault(k, []).append(f"{step:+.1f} dB step at {t['t']}s")
            for cid, d in delta.items():
                base = float((tl["clips"][idx[cid]].get("audio") or {}).get("gain_db", 0))
                d = max(-6.0, min(6.0, d))
                if abs(d) >= 1.0:
                    ops.append({"op": "audio", "clip": cid, "gain_db": round(base + d, 1),
                                "why": "level match: " + ", ".join(whys[cid])})
        elif c["id"] in ("black_frames",):
            for t in c["timestamps"]:
                ops.append({"op": "replace", "clip": t["clip"].split("-")[0], "why": f"black frames at {t['t']}s"})
        elif c["id"] == "repeated_shots":
            for t in c["timestamps"]:
                ops.append({"op": "replace", "clip": t["clip"].split("-")[0], "why": f"repeats {t['clips'][0]}"})
    for o in ops:
        o["source"] = "qc"          # applied leniently: skipped if an explicit op removed the clip first
    return ops
