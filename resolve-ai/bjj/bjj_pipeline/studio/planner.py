"""Stage 3 - plan the edit: brief (+ optional reference params) + candidates -> timeline v1.

Rules that matter for combat sports:
  * Action is cut on lulls, not mid-exchange: in/out points are moved to the
    quietest moment near the planned edge (dense 12 fps motion track), and an
    action clip may run up to 2x the target shot length to finish the exchange.
  * Two cameras of the same moment are never laid back-to-back as if they were
    different moments (that would invent continuity).  Overlap evidence from
    ingest maps every clip onto a shared "event clock"; clips that overlap on it
    are de-duplicated (the better one wins).
  * Vertical reframing keeps the WHOLE movement extent in frame.  If both
    athletes do not fit in a 9:16 crop, the clip is shown full-width over a
    blurred fill instead of cutting one of them off - and that is flagged.
  * Slow motion only when the source has real frames for it (fps / timeline fps >= 2).
  * Stabilisation only on shaky clips; very shaky clips are flagged instead
    (stabilising them would crop/warp too much).
  * Exposure is normalised with gamma only (no saturation push): skin tones stay put.
"""
from __future__ import annotations

from collections import deque
from fractions import Fraction
from pathlib import Path

from ..util import LOG, parse_fps, read_json
from .jobs import StudioError, stage
from .project import FORMATS, Brief, Project, fingerprint
from .timeline import new_timeline, save_version, validate

PLAN_VERSION = "plan-v5"

KIND_DEFAULTS = {
    #                  shot_s  open_s  transition   slowmo  chrono
    "athlete_highlight": (1.8, 2.4, "cut", True, False),
    "team_recap": (2.2, 2.8, "dissolve", False, False),
    "tournament_reel": (1.4, 2.0, "cut", True, False),
    "promo": (1.2, 1.6, "cut", True, False),
    "fight_edit": (5.0, 4.0, "cut", False, True),
}
CROP_MARGIN = 0.06


def timeline_fps(assets: list[dict], brief: Brief) -> str:
    if brief.fps:
        f = parse_fps(brief.fps)
        return f"{f.numerator}/{f.denominator}"
    vids = [a for a in assets if a["kind"] == "video"]
    if not vids:
        return "30/1"
    counts: dict[int, int] = {}
    for a in vids:
        r = round(a["fps_float"])
        counts[r] = counts.get(r, 0) + 1
    best = max(counts.items(), key=lambda kv: (kv[1], -kv[0]))[0]
    base = {50: 25, 100: 25, 60: 30, 120: 30, 240: 30}.get(best, best)
    if base not in (24, 25, 30):
        base = 30
    ntsc = any(a["fps"].endswith("/1001") for a in vids)
    return f"{base * 1000}/1001" if ntsc and base in (24, 30) else f"{base}/1"


def event_clock(index: dict) -> dict[str, tuple[str, float]]:
    """asset -> (group root, seconds to add to local time to get group time); high-confidence overlaps only."""
    adj: dict[str, list[tuple[str, float]]] = {}
    for o in index.get("overlaps", []):
        if o["confidence"] != "high":
            continue
        # same moment: t_a = t_b + offset.  An edge (u -> v, d) means local_v = local_u + d, so with
        # group time = local + C:  C_v = C_u - d.
        adj.setdefault(o["b"], []).append((o["a"], o["offset_s"]))
        adj.setdefault(o["a"], []).append((o["b"], -o["offset_s"]))
    clock: dict[str, tuple[str, float]] = {}
    for root in adj:
        if root in clock:
            continue
        clock[root] = (root, 0.0)
        q = deque([root])
        while q:
            u = q.popleft()
            for v, off in adj[u]:
                if v not in clock:
                    clock[v] = (root, clock[u][1] - off)
                    q.append(v)
    return clock


def _lull(track: dict | None, around: float, lo: float, hi: float) -> float:
    """Quietest moment of the dense motion track within [lo, hi]; falls back to `around`."""
    if not track or not track.get("track"):
        return around
    pts = [p for p in track["track"] if lo <= p["t"] <= hi]
    if not pts:
        return around
    best = min(pts, key=lambda p: (p["mass"], abs(p["t"] - around)))
    return best["t"]


def reframe(asset: dict, cand: dict, W: int, H: int) -> tuple[dict, list[str]]:
    sw, sh = asset["width"], asset["height"]
    if not sw or not sh:
        return {"mode": "fit_pad"}, []
    src_ar, out_ar = sw / sh, W / H
    if abs(src_ar - out_ar) < 0.02:
        return {"mode": "none"}, []
    if out_ar > src_ar:            # e.g. vertical phone clip into landscape output
        return {"mode": "fit_blur"}, ["narrower source shown full-height over blurred fill"]
    w = out_ar / src_ar             # crop width fraction of the source
    tr = cand.get("track")
    if not tr or not tr.get("extent"):
        return {"mode": "crop", "x": 0.5, "w": round(w, 4)}, ["no movement track for this moment - centred crop, "
                                                             "check that the athletes are in frame"]
    if tr.get("active_ratio", 0) < 0.15:
        return {"mode": "fit_blur"}, ["almost no movement to frame on - kept full-width over a blurred fill "
                                      "(a blind centre crop could cut people off)"]
    x0, x1 = tr["extent"]
    need = (x1 - x0) + 2 * CROP_MARGIN
    if need <= w:
        cx = (x0 + x1) / 2
        cx = min(max(cx, w / 2), 1 - w / 2)
        return {"mode": "crop", "x": round(cx, 4), "w": round(w, 4), "extent": [x0, x1]}, \
               [f"crop follows movement extent {x0:.0%}-{x1:.0%} (fits the {w:.0%}-wide window)"]
    return {"mode": "fit_blur", "extent": [x0, x1]}, \
        [f"movement spans {x1 - x0:.0%} of the width but a vertical crop only shows {w:.0%}: "
         "kept full-width over a blurred fill so both athletes stay visible"]


def _color(clip_summary: dict | None, look: str | None) -> dict:
    luma = (clip_summary or {}).get("luma_mean", 118.0)
    target = 116.0
    gamma = 1.0
    if luma < 95:
        gamma = min(1.35, (target / max(luma, 20)) ** 0.6)
    elif luma > 150:
        gamma = max(0.82, (target / luma) ** 0.6)
    col = {"gamma": round(gamma, 3), "contrast": 1.0, "saturation": 1.0}
    if look == "punchy":
        col.update(contrast=1.06, saturation=1.05)
    elif look == "dark_moody":
        col.update(contrast=1.05, saturation=0.97)
    return col


def _balance_natural_sound(proj: Project, clips: list[dict], tl: dict) -> None:
    """Pre-level natural sound so neighbouring clips do not jump 20 dB (phones record at very different
    levels).  Uses the cached per-second audio level of each clip's window; moves each clip to the
    median (capped at +/-9 dB so a revision can still fine-tune), never boosting near-silence."""
    from ..util import read_json as _rj
    levels = {}
    for c in clips:
        if c["kind"] == "photo" or c["audio"]["gain_db"] <= -80 or c["speed"] < 1:
            continue
        f = proj.root / "cache" / "analysis" / f"{c['asset']}.json"
        if not f.exists():
            continue
        bins = [b["audio_db"] for b in _rj(f)["per_second"] if c["src_in"] - 0.5 <= b["t"] < c["src_out"]]
        if bins:
            levels[c["id"]] = sum(bins) / len(bins)
    if len(levels) < 2:
        return
    med = sorted(levels.values())[len(levels) // 2]
    for c in clips:
        lv = levels.get(c["id"])
        if lv is None or lv < -55:
            continue
        adj = max(-9.0, min(9.0, med - lv))
        if abs(adj) >= 1.0:
            c["audio"]["gain_db"] = round(c["audio"]["gain_db"] + adj, 1)
            c["notes"].append(f"natural sound levelled {adj:+.1f} dB toward the edit's median ({lv:.0f} -> {med:.0f} dBFS)")


def plan(proj: Project, *, use_reference: bool = True) -> dict:
    brief = proj.brief
    cands_doc = read_json(proj.root / "cache" / "candidates.json")
    index = read_json(proj.root / "cache" / "index.json") if (proj.root / "cache" / "index.json").exists() else {}
    ref = None
    if use_reference and (proj.root / "reference" / "breakdown.json").exists():
        ref = read_json(proj.root / "reference" / "breakdown.json")["params"]
    fp = fingerprint(PLAN_VERSION, proj.state["brief"], cands_doc.get("candidates"), index.get("overlaps"), ref)
    with stage(proj, "plan", fp) as ctx:
        if ctx["skip"]:
            from .timeline import load
            return load(proj)
        tl = build_timeline(proj, brief, cands_doc, index, ref)
        issues = validate(tl, {a["id"]: a for a in proj.assets})
        errors = [i for i in issues if i.level == "error"]
        if errors:
            raise StudioError("planner produced an invalid timeline: " + "; ".join(f"{e.where}: {e.message}" for e in errors),
                              "this is a bug - please report it with project.json")
        tl["notes"] += [f"{i.where}: {i.message}" for i in issues]
        path = save_version(proj, tl, "initial plan" + (" (reference-guided)" if ref else " (brief only)"))
        ctx["outputs"] = [str(path.relative_to(proj.root))]
        ctx["extra"] = {"timeline_version": tl["version"] if "version" in tl else proj.state["timeline_version"]}
        LOG.info("plan: %d clips, %.1fs -> %s", len(tl["clips"]), sum(1 for _ in tl["clips"]), path)
        return read_json(path)


def build_timeline(proj: Project, brief: Brief, cands_doc: dict, index: dict, ref: dict | None) -> dict:
    assets = {a["id"]: a for a in proj.assets if a["status"] == "ok"}
    W, H = FORMATS[brief.format]
    fps = timeline_fps(list(assets.values()), brief)
    fps_f = float(parse_fps(fps))
    shot_s, open_s, transition, slowmo_default, chrono = KIND_DEFAULTS[brief.kind]
    chrono = chrono or brief.keep_chronology
    look = None
    if ref:
        # reference pacing, clamped to what is watchable for grappling (it is slower than dance edits)
        shot_s = min(max(ref["shot_len_median_s"], 0.7), 4.0 if brief.kind != "fight_edit" else 12.0)
        if ref.get("hook_first_shot_s"):
            open_s = min(max(ref["hook_first_shot_s"], 0.8), 3.5)
        look = ref.get("look")
    tl = new_timeline(fps=fps, width=W, height=H, fmt=brief.format, name=brief.title or proj.state["name"])
    tl["reference_params"] = ref
    tl["brief_kind"] = brief.kind
    clock = event_clock(index)
    cands = [c for c in cands_doc["candidates"] if c["asset"] in assets]
    clip_summ = cands_doc.get("clips", {})
    music = brief.music
    target = brief.target_seconds

    def score(c):
        sc = 0.55 * c["editorial"] + 0.45 * c["technical"]
        if (clip_summ.get(c["asset"]) or {}).get("luma_mean", 118) < 30:
            sc -= 60          # too dark to rescue with a safe grade: only used when nothing else is left
        return sc

    actions = sorted([c for c in cands if c["category"] == "action"], key=score, reverse=True)
    reactions = sorted([c for c in cands if c["category"] in ("celebration_or_reaction", "crowd_or_coach_reaction")],
                       key=score, reverse=True)
    broll = sorted([c for c in cands if c["category"] in ("entrance_bench_or_broll", "broll")], key=score, reverse=True)
    photos = [c for c in cands if c["category"] == "photo"]
    # Last resort only: near-black sources and shots in which nothing moves at all ("sits there doing nothing").
    # They are used only if the edit would otherwise be far too short, and then flagged.
    def _weak(c):
        dark = (clip_summ.get(c["asset"]) or {}).get("luma_mean", 118) < 30
        still = bool(c.get("track")) and c["track"].get("active_ratio", 1) < 0.05
        return dark or still
    last_resort = [c for c in actions + reactions + broll if _weak(c)]
    actions = [c for c in actions if not _weak(c)]
    reactions = [c for c in reactions if not _weak(c)]
    broll = [c for c in broll if not _weak(c)]
    # Many fixtures/phones produce reaction-flagged action (audio rises with the exchange). If there are no
    # action candidates, the best reactions with movement are treated as action material.
    if not actions:
        actions = [c for c in reactions if c.get("track") and c["track"]["active_ratio"] > 0.4]
        reactions = [c for c in reactions if c not in actions]

    used_event: list[tuple[str, float, float]] = []      # (group, t0, t1) on the event clock

    def ev_span(c, a0, a1):
        g, off = clock.get(c["asset"], (c["asset"], 0.0))
        return g, a0 + off, a1 + off

    def overlaps_used(c, a0, a1) -> bool:
        g, t0, t1 = ev_span(c, a0, a1)
        return any(g == ug and min(t1, u1) - max(t0, u0) > 0.25 for ug, u0, u1 in used_event)

    clips: list[dict] = []

    def queue_for(c: dict) -> list[dict]:
        if c in actions or c["category"] == "action" and c not in reactions:
            return actions
        if "reaction" in c["category"]:
            return reactions
        return broll

    def add(c: dict, role: str, length: float, slow: bool = False, why: str = "") -> bool:
        a = assets[c["asset"]]
        notes: list[str] = []
        if c["kind"] == "photo":
            clip = {"id": f"c{len(clips) + 1:02d}", "asset": a["id"], "kind": "photo", "hold": round(length, 2),
                    "src_in": 0.0, "src_out": 0.0, "speed": 1.0, "role": role, "candidate": c["id"],
                    "reframe": {"mode": "fit_blur" if (a["width"] / max(a["height"], 1)) > W / H + 0.02 else "crop",
                                "x": 0.5, "w": min(1.0, (W / H) / (a["width"] / max(a["height"], 1))), "kenburns": True},
                    "stabilize": False, "color": {"gamma": 1.0, "contrast": 1.0, "saturation": 1.0},
                    "audio": {"gain_db": -90.0, "fade_in": 0.0, "fade_out": 0.0},
                    "transition_in": {"type": "cut", "duration": 0.0},
                    "reason": why or "still photo used as a held beat", "notes": []}
            clips.append(clip)
            return True
        speed = 1.0
        if slow and brief.allow_slowmo:
            factor = a["fps_float"] / fps_f
            if factor >= 1.95:
                speed = round(max(0.25, 1.0 / min(factor, 4.0)), 3)
                notes.append(f"real-frame slow motion {speed:.0%} ({a['fps_float']:.0f} fps source on {fps_f:.0f} fps)")
            else:
                notes.append(f"no slow motion: {a['fps_float']:.0f} fps source has no spare frames")
        src_len = length * speed
        peak = c.get("peak_t") or (c["start"] + c["end"]) / 2
        if c["category"] == "action":
            # start before the peak so the exchange builds, then end on a lull after it
            want_in = peak - src_len * 0.55
            a_in = _lull(c.get("track"), want_in, want_in - 0.6, peak - 0.3)
            want_out = a_in + src_len
            a_out = _lull(c.get("track"), want_out, peak + 0.3, min(want_out + src_len, peak + 2 * src_len))
            if a_out - a_in < src_len * 0.7:
                a_out = a_in + src_len
            if (a_out - a_in) / speed > 2 * max(length, shot_s):
                a_out = a_in + 2 * max(length, shot_s) * speed
        else:
            a_in = max(c["start"], peak - src_len / 2)
            a_out = a_in + src_len
        a_in = max(0.0, a_in)
        a_out = min(a["duration"] - 0.05, a_out)
        if a_out - a_in < 0.5 * speed:
            return False
        if overlaps_used(c, a_in, a_out):
            # this window shows a moment already used (maybe from another camera): try a later window instead
            if c["end"] - (a_out + 0.3) >= max(1.0, src_len):
                later = dict(c, id=c["id"] + ">", start=round(a_out + 0.3, 3),
                             peak_t=round(a_out + 0.3 + (c["end"] - a_out - 0.3) / 2, 3))
                queue_for(c).append(later)
            return False
        rf, rnotes = reframe(a, c, W, H)
        notes += rnotes
        luma = (clip_summ.get(a["id"]) or {}).get("luma_mean", 118)
        if luma < 30:
            notes.append(f"source is very dark (mean luma {luma:.0f}/255): exposure cannot be rescued without "
                         "noise/banding - replace if possible")
        st = c.get("scores", {}).get("stability", 100)
        stabilize = False
        if brief.allow_stabilize and st < 40:
            if st < 18:
                notes.append(f"very shaky (stability {st:.0f}); NOT stabilised - would crop/warp too much; kept short")
                a_out = min(a_out, a_in + 1.2 * speed)
            else:
                stabilize = True
                notes.append(f"stabilised (stability {st:.0f}); expect ~8% edge crop")
        g, t0, t1 = ev_span(c, a_in, a_out)
        used_event.append((g, t0, t1))
        # long candidates can give another, later shot (never overlapping the one just used)
        rest = c["end"] - (a_out + 0.3)
        if c["category"] != "photo" and rest >= max(1.0, length * speed * 1.2):
            nxt = dict(c, id=c["id"] + "+", start=round(a_out + 0.3, 3), editorial=c["editorial"] * 0.9,
                       peak_t=round(a_out + 0.3 + rest / 2, 3))
            queue_for(c).append(nxt)
        nat = 0.0 if c["category"] != "action" else (-6.0 if music else 0.0)
        tr_type = transition if clips and brief.kind != "fight_edit" else "cut"
        clip = {"id": f"c{len(clips) + 1:02d}", "asset": a["id"], "kind": "video", "src_in": round(a_in, 3),
                "src_out": round(a_out, 3), "speed": speed, "role": role, "candidate": c["id"], "reframe": rf,
                "stabilize": stabilize, "color": _color(clip_summ.get(a["id"]), look),
                "audio": {"gain_db": nat if brief.natural_sound else -90.0, "fade_in": 0.04, "fade_out": 0.06},
                "transition_in": {"type": tr_type, "duration": 0.3 if tr_type == "dissolve" else 0.0},
                "reason": "; ".join([why] + c.get("reasons", [])[:2]).strip("; "), "notes": notes}
        clips.append(clip)
        return True

    total = lambda: sum((c["hold"] if c["kind"] == "photo" else (c["src_out"] - c["src_in"]) / c["speed"]) for c in clips)

    if chrono:
        pool = sorted(actions + reactions, key=lambda c: (clock.get(c["asset"], (c["asset"], 0))[0],
                                                          c["start"] + clock.get(c["asset"], ("", 0.0))[1]))
        for c in pool:
            if total() >= target:
                break
            add(c, "action" if c["category"] == "action" else "reaction",
                min(max(c["end"] - c["start"], 2.0), shot_s * 2), why="chronological fight edit")
    else:
        # hook: the strongest action moment, short, real-frame slow motion if the source supports it
        if actions:
            add(actions[0], "hook", open_s, slow=slowmo_default, why="hook: strongest action moment")
        elif photos:
            add(photos.pop(0), "hook", open_s, why="hook: photo (no action detected)")
        # Work through queues; never put two clips from the same recording back to back when another
        # source is available (that reads as a jump cut and fakes continuity).
        actions = actions[1:] if clips else actions

        def pick(order: list[tuple[list[dict], str]]) -> tuple[dict, str] | None:
            """First candidate (in queue preference order) from a different recording than the last clip;
            if every queue only offers the same recording, the first available one."""
            last = clips[-1]["asset"] if clips else None
            for lst, role in order:
                for k, c in enumerate(lst):
                    if c["asset"] != last:
                        return lst.pop(k), role
            for lst, role in order:
                if lst:
                    return lst.pop(0), role
            return None

        n_since_reaction = 0
        guard = 0
        while total() < target - 0.5 * shot_s and guard < 300:
            guard += 1
            if n_since_reaction >= 2:
                order = [(reactions, "reaction"), (actions, "action"), (broll, "broll")]
            else:
                order = [(actions, "action"), (reactions, "reaction"), (broll, "broll")]
            got = pick(order)
            if got is None:
                break
            c, role = got
            length = max(1.2, shot_s * 0.8) if role == "reaction" else shot_s
            why = {"action": "action", "reaction": "reaction / breather between exchanges",
                   "broll": "breather / establishing"}[role]
            if add(c, role, length, why=why):
                n_since_reaction = 0 if role == "reaction" else n_since_reaction + 1
        if total() < target * 0.6 and last_resort:
            tl["notes"].append("not enough moving, well-exposed material: added flagged last-resort shots "
                               "(very dark or static) - replace them if you have more footage")
            while last_resort and total() < target * 0.8:
                c = last_resort.pop(0)
                add(c, "broll", shot_s, why="last resort (dark or static) - flagged")
        ri = 0
        same = sum(1 for a, b in zip(clips, clips[1:]) if a["asset"] == b["asset"])
        if same:
            tl["notes"].append(f"{same} back-to-back cut(s) from the same recording (no other source available there)")
        closer = next((c for c in reactions[ri:] if c["category"] == "celebration_or_reaction"), None)
        if closer and total() + max(2.0, shot_s) <= target * 1.1:
            add(closer, "closing", max(2.0, shot_s), why="closing on a reaction")
        if photos and total() + 2.0 <= target * 1.1:
            add(photos[0], "closing", 2.0, why="closing photo")
    if not clips:
        raise StudioError("no usable moments found in the footage", "check ingest results (all files damaged or duplicates?)")
    _balance_natural_sound(proj, clips, tl)
    # never hard-cut natural sound into intended silence (photo hold, muted or slow-motion clip)
    for a, b in zip(clips, clips[1:]):
        silent_next = b["kind"] == "photo" or b["audio"]["gain_db"] <= -80 or b["speed"] < 1
        if silent_next and not music and a["kind"] != "photo":
            a["audio"]["fade_out"] = max(a["audio"].get("fade_out", 0.06), 0.4)
    tl["clips"] = clips
    dur = sum((c["hold"] if c["kind"] == "photo" else (c["src_out"] - c["src_in"]) / c["speed"]) for c in clips)
    dur -= sum(c["transition_in"]["duration"] for c in clips[1:])
    if dur < target * 0.8:
        tl["notes"].append(f"only {dur:.1f}s of distinct usable material for a {target:.0f}s target - nothing was "
                           "repeated to pad it; add footage or shorten the target")
    # captions from the brief
    caps = []
    for k, cap in enumerate(brief.captions):
        s, e = cap.start, cap.end
        if s is None:
            if cap.role == "cta":
                s, e = max(0.0, dur - 2.6), dur - 0.1
            elif cap.role == "title":
                s, e = 0.25, min(dur, 0.25 + max(1.6, len(cap.text) / 14))
            else:
                s, e = min(dur - 1.5, 3.0 + 2.5 * k), min(dur, 5.5 + 2.5 * k)
        caps.append({"id": f"t{k + 1}", "text": cap.text, "lang": cap.lang, "start": round(s, 2),
                     "end": round(e if e is not None else s + 2.5, 2), "position": cap.position, "role": cap.role,
                     "anchor": "end" if (cap.role == "cta" and cap.start is None) else "start"})
    tl["captions"] = caps
    if music:
        if not Path(music).exists():
            tl["notes"].append(f"music file not found: {music} - rendering with natural sound only")
        else:
            tl["music"] = {"path": str(Path(music).resolve()), "gain_db": brief.music_gain_db, "duck_db": 6.0,
                           "fade_in": 0.3, "fade_out": 1.5, "start": 0.0}
    tl["notes"].append(f"pacing: target shot {shot_s:.2f}s, hook {open_s:.2f}s"
                       + (f" (from reference: median shot {ref['shot_len_median_s']}s, {ref['pacing']})" if ref else
                          f" (brief-only defaults for {brief.kind})"))
    return tl
