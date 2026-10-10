"""Stage D - edit plans.

Four templates produce an EditPlan (ordered cuts with speed, transition and
title hints).  Plans are *proposals*: every cut keeps a reference to the
source clip + timecodes so the editor can change anything in Resolve.

Speed changes are only proposed when the source frame rate allows it without
inventing frames (see MediaInfo.max_clean_slowmo_factor).  Otherwise the plan
asks for Optical Flow / Speed Warp and says so in the notes.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import numpy as np

from .analyze import read_audio_rms
from .quality import RankedSegment
from .util import LOG, parse_fps


@dataclass
class Cut:
    order: int
    clip: str
    clip_path: str
    src_in: float            # seconds in source
    src_out: float
    speed: float = 1.0       # 1.0 normal, 0.5 = half speed (slow motion)
    speed_note: str = ""
    transition_in: str = "cut"   # cut | cross_dissolve | dip_to_black | smooth_cut
    transition_frames: int = 0
    title: str | None = None
    role: str = "action"     # opening | action | reaction | b_roll | closing
    labels: list[str] = field(default_factory=list)
    score: float = 0.0
    notes: str = ""

    @property
    def record_duration(self) -> float:
        return (self.src_out - self.src_in) / max(self.speed, 1e-6)


@dataclass
class EditPlan:
    name: str
    template: str
    timeline_fps: str
    target_min_s: float
    target_max_s: float
    cuts: list[Cut]
    music: str | None = None
    beat_interval_s: float | None = None
    athletes: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    render_presets: list[str] = field(default_factory=list)

    @property
    def total_duration(self) -> float:
        return sum(c.record_duration for c in self.cuts)


TEMPLATES = {
    "cinematic": dict(target=(15, 30), max_cut=4.0, min_cut=1.2, slowmo=True, transitions="cross_dissolve",
                      presets=["instagram_reel", "master"]),
    "high_energy": dict(target=(15, 45), max_cut=1.6, min_cut=0.5, slowmo=False, transitions="cut",
                        presets=["instagram_reel", "instagram_story", "master"]),
    "full_highlights": dict(target=(60, 120), max_cut=8.0, min_cut=2.0, slowmo=True, transitions="cut",
                            presets=["youtube", "master"]),
    "club_recap": dict(target=(45, 90), max_cut=4.0, min_cut=1.5, slowmo=False, transitions="cross_dissolve",
                       presets=["youtube", "instagram_reel", "master"]),
}


def estimate_beat_interval(music: Path) -> float | None:
    """Rough tempo from loudness onsets (no librosa needed). Returns seconds per beat."""
    rms = read_audio_rms(music, window_s=0.05)
    if len(rms) < 40:
        return None
    x = np.array([r.rms_db for r in rms])
    onset = np.clip(np.diff(x), 0, None)
    onset = onset - onset.mean()
    # autocorrelation over 0.3 .. 1.2 s (50-200 BPM)
    lags = range(int(0.3 / 0.05), int(1.2 / 0.05))
    best, best_v = None, -1e9
    for lag in lags:
        v = float(np.dot(onset[:-lag], onset[lag:]))
        if v > best_v:
            best_v, best = v, lag
    return best * 0.05 if best else None


def _snap(duration: float, beat: float | None, min_cut: float) -> float:
    if not beat:
        return duration
    n = max(1, round(duration / beat))
    return max(min_cut, n * beat)


def _pick(segments: list[RankedSegment], athlete: str | None = None) -> list[RankedSegment]:
    segs = [s for s in segments if not athlete or athlete.lower() in s.clip_path.lower()]
    # prefer reviewed/non-flagged segments but never drop flagged ones outright
    segs.sort(key=lambda s: (len(s.scores.review_flags) > 1, -s.scores.total))
    return segs


def _slowmo_for(seg: RankedSegment, timeline_fps: float, allow: bool) -> tuple[float, str]:
    if not allow:
        return 1.0, ""
    factor = max(1.0, round(seg.fps / timeline_fps, 3))
    if factor >= 2.0:
        speed = round(1.0 / min(factor, 4.0), 3)   # never slower than 25 %
        return speed, f"clean slow motion: {seg.fps:.3g} fps source on {timeline_fps:.3g} fps timeline ({speed:.0%})"
    return 1.0, (f"no clean slow motion ({seg.fps:.3g} fps source); if you want slow-mo use Optical Flow "
                 "(Free) or Speed Warp (Studio) and accept synthesized frames")


def build_plan(template: str, segments: list[RankedSegment], timeline_fps: Fraction | str, *, name: str,
               music: Path | None = None, athlete: str | None = None, athletes: list[str] | None = None,
               include_flagged: bool = False) -> EditPlan:
    if template not in TEMPLATES:
        raise ValueError(f"unknown template {template}; choose from {sorted(TEMPLATES)}")
    cfg = TEMPLATES[template]
    tfps = parse_fps(timeline_fps)
    tfps_f = float(tfps)
    lo, hi = cfg["target"]
    beat = estimate_beat_interval(music) if (music and template == "high_energy") else None
    plan = EditPlan(name=name, template=template, timeline_fps=f"{tfps.numerator}/{tfps.denominator}",
                    target_min_s=lo, target_max_s=hi, cuts=[], music=str(music) if music else None,
                    beat_interval_s=beat, athletes=athletes or ([athlete] if athlete else []),
                    render_presets=list(cfg["presets"]))
    if beat:
        plan.notes.append(f"beat grid ~{60 / beat:.0f} BPM; cut lengths snapped to beats")

    pool = _pick(segments, athlete)
    if not include_flagged:
        strict = [s for s in pool if len(s.scores.review_flags) <= 1]
        pool = strict or pool
    if not pool:
        plan.notes.append("no segments available")
        return plan

    # --- club recap: round-robin across athletes for balanced representation
    if template == "club_recap" and athletes:
        per: dict[str, list[RankedSegment]] = {a: _pick(segments, a) for a in athletes}
        ordered: list[RankedSegment] = []
        while any(per.values()) and sum(s.end - s.start for s in ordered) < hi * 1.5:
            for a in athletes:
                if per[a]:
                    ordered.append(per[a].pop(0))
        pool = ordered
        plan.notes.append("athletes interleaved for balanced representation")

    # --- assemble
    budget = (lo + hi) / 2
    used = 0.0
    order = 0
    reactions = [s for s in pool if s.kind in ("celebration_candidate", "crowd_reaction")]
    actions = [s for s in pool if s.kind not in ("celebration_candidate", "crowd_reaction", "low_activity")]
    broll = [s for s in pool if s.kind == "low_activity"]

    def add(seg: RankedSegment, role: str, title: str | None = None, force_slow: bool | None = None) -> None:
        nonlocal used, order
        max_cut = cfg["max_cut"]
        if role == "opening":
            max_cut = min(5.0, max_cut + 1.5)
        length = min(seg.end - seg.start, max_cut)
        length = _snap(length, beat, cfg["min_cut"])
        # centre the cut on the segment's middle
        mid = (seg.start + seg.end) / 2
        src_in = max(0.0, mid - length / 2)
        src_out = min(seg.duration_total, src_in + length)
        allow_slow = cfg["slowmo"] if force_slow is None else force_slow
        speed, note = _slowmo_for(seg, tfps_f, allow_slow and role in ("opening", "action", "closing"))
        if speed < 1.0:
            # keep the record duration inside the cut budget
            src_len = max(cfg["min_cut"], min(src_out - src_in, max_cut * speed))
            src_out = min(seg.duration_total, src_in + src_len)
        order += 1
        cut = Cut(order=order, clip=seg.clip, clip_path=seg.clip_path, src_in=src_in, src_out=src_out, speed=speed,
                  speed_note=note, transition_in=("cut" if order == 1 else cfg["transitions"]),
                  transition_frames=(0 if order == 1 or cfg["transitions"] == "cut" else int(round(0.5 * tfps_f))),
                  title=title, role=role, labels=seg.labels, score=seg.scores.total,
                  notes=(seg.notes + (" | REVIEW: " + ", ".join(seg.scores.review_flags) if seg.scores.review_flags else "")))
        plan.cuts.append(cut)
        used += cut.record_duration

    # opening: cinematic wants an emotional / atmospheric start (walkout or reaction), others start on action
    if template == "cinematic":
        opener = (broll or reactions or actions)[0]
        add(opener, "opening", title=name)
        (broll if opener in broll else reactions if opener in reactions else actions).remove(opener)
    elif template == "full_highlights":
        # chronological story: sort actions by clip + time
        actions.sort(key=lambda s: (s.clip_path, s.start))
    for seg in actions:
        if used >= budget:
            break
        add(seg, "action")
        # follow a strong action with a reaction when available (narrative pay-off)
        if reactions and used < budget and seg.kind == "action_peak" and seg.scores.total > 60:
            add(reactions.pop(0), "reaction", force_slow=False)
    # closing: strongest remaining reaction, else last action
    closer = reactions[0] if reactions else None
    if closer and used < hi:
        add(closer, "closing", title=None)
    if used < lo:
        plan.notes.append(f"plan is {used:.1f}s, under the {lo}s target: not enough strong material (nothing was discarded; "
                          "lower the threshold or include flagged segments with --include-flagged)")
    LOG.info("plan %s: %d cuts, %.1fs (target %d-%ds)", name, len(plan.cuts), plan.total_duration, lo, hi)
    return plan
