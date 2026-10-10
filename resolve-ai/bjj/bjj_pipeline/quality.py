"""Stage C - rank footage.

Scores are 0..100 per clip and per candidate segment.  Weights are
configurable (config/scoring.json).  Nothing is ever discarded automatically:
low scores only set a `review_flags` list; the editor decides.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .analyze import ClipAnalysis, Event
from .util import read_json

DEFAULT_WEIGHTS = {
    "focus": 0.16,
    "motion_blur": 0.10,
    "stability": 0.12,
    "composition": 0.10,
    "subject_visibility": 0.10,
    "action_intensity": 0.14,
    "lighting": 0.10,
    "narrative_importance": 0.10,
    "usability": 0.08,
}

# Review thresholds (not discard thresholds).
FLAG_RULES = {
    "soft_focus": ("focus", 35),
    "shaky": ("stability", 35),
    "under_or_over_exposed": ("lighting", 35),
    "subject_unclear": ("subject_visibility", 30),
}


@dataclass
class Scores:
    focus: float
    motion_blur: float
    stability: float
    composition: float
    subject_visibility: float
    action_intensity: float
    lighting: float
    narrative_importance: float
    usability: float
    total: float
    review_flags: list[str] = field(default_factory=list)


@dataclass
class RankedSegment:
    clip: str
    clip_path: str
    start: float
    end: float
    kind: str
    labels: list[str]
    confidence: float
    scores: Scores
    needs_review: bool
    notes: str
    fps: float
    duration_total: float


def load_weights(path: Path | None) -> dict[str, float]:
    w = dict(DEFAULT_WEIGHTS)
    if path and Path(path).exists():
        w.update({k: float(v) for k, v in read_json(path).get("weights", {}).items() if k in w})
    s = sum(w.values())
    return {k: v / s for k, v in w.items()}


def _scale(x: float, lo: float, hi: float) -> float:
    """Linear map lo..hi -> 0..100, clipped."""
    if hi == lo:
        return 50.0
    return float(np.clip((x - lo) / (hi - lo) * 100.0, 0, 100))


def _window(bins: list[dict], start: float, end: float) -> list[dict]:
    sel = [b for b in bins if start <= b["t"] < max(end, start + 1)]
    return sel or bins[:1]


def score_segment(an: ClipAnalysis, start: float, end: float, weights: dict[str, float],
                  narrative: float = 50.0, clip_ref: dict | None = None) -> Scores:
    """Score one time window of a clip.

    Reference values come from the whole clip (clip_ref) so a clip that is
    uniformly soft is still ranked fairly against its own best moments, while
    absolute floors catch genuinely unusable material.
    """
    w = _window(an.per_second, start, end)
    sharp = float(np.mean([b["sharpness"] for b in w]))
    shake = float(np.mean([b["shake"] for b in w]))
    motion = float(np.mean([b["motion"] for b in w]))
    luma = float(np.mean([b["luma"] for b in w]))
    clipped = float(np.mean([b["clipped"] for b in w]))
    center = float(np.mean([b["center_edges"] for b in w]))
    action = float(np.mean([b["action"] for b in w]))

    ref = clip_ref or an.summary
    # Focus: Laplacian variance. Typical sharp 1080p footage downscaled to 256px
    # lands ~80-400; soft/blurred < 30. Blend absolute and clip-relative.
    focus_abs = _scale(sharp, 15, 250)
    focus_rel = _scale(sharp, ref.get("sharpness_p10", 0) * 0.8, max(ref.get("sharpness_median", 1), 1) * 1.2)
    focus = 0.6 * focus_abs + 0.4 * focus_rel

    # Motion blur proxy: sharpness drop while motion is high.
    if motion > 1.0:
        blur = _scale(sharp / max(motion, 1e-6), 2, 40)
    else:
        blur = 85.0

    # Stability: global shift in small-image pixels per sampled frame.
    # 0-0.5 locked off / tripod; 1-2 handheld; >4 very shaky.
    stability = 100.0 - _scale(shake, 0.3, 4.5)

    # Lighting: mid luma best; penalise clipping.
    lighting = 100.0 - _scale(abs(luma - 118), 25, 95) - min(40.0, clipped * 400)
    lighting = float(np.clip(lighting, 0, 100))

    # Composition / subject visibility proxies from centre-weighted edges.
    composition = _scale(center, 0.6, 1.6)
    subject = _scale(center, 0.7, 1.8)

    action_intensity = action * 100.0

    usability = float(np.clip(0.5 * focus + 0.3 * stability + 0.2 * lighting, 0, 100))

    parts = {
        "focus": focus, "motion_blur": blur, "stability": stability, "composition": composition,
        "subject_visibility": subject, "action_intensity": action_intensity, "lighting": lighting,
        "narrative_importance": float(np.clip(narrative, 0, 100)), "usability": usability,
    }
    total = sum(parts[k] * weights[k] for k in weights)
    flags = [name for name, (key, floor) in FLAG_RULES.items() if parts[key] < floor]
    return Scores(**parts, total=float(total), review_flags=flags)


def narrative_hint(ev: Event) -> float:
    """Narrative importance prior from the event kind (editor overrides later)."""
    return {
        "celebration_candidate": 80.0,
        "action_peak": 70.0,
        "crowd_reaction": 55.0,
        "low_activity": 40.0,
        "scene_cut": 30.0,
    }.get(ev.kind, 50.0) * (0.6 + 0.4 * ev.confidence)


def rank(analyses: list[ClipAnalysis], weights: dict[str, float], min_len: float = 1.5) -> list[RankedSegment]:
    out: list[RankedSegment] = []
    for an in analyses:
        events = [e for e in an.events if e.kind != "scene_cut" and e.duration >= min_len]
        if not events:  # no events? still rank the clip as a whole so it is never lost
            events = [Event(clip=an.media.filename, start=0.0, end=an.media.duration, kind="whole_clip",
                            score=an.summary["action_mean"], confidence=0.3,
                            suggested_labels=["b_roll", "unknown"], notes="No heuristic events; whole clip kept for review.")]
        for ev in events:
            sc = score_segment(an, ev.start, ev.end, weights, narrative=narrative_hint(ev))
            out.append(RankedSegment(
                clip=an.media.filename, clip_path=an.media.path, start=ev.start, end=ev.end, kind=ev.kind,
                labels=ev.suggested_labels, confidence=ev.confidence, scores=sc,
                needs_review=ev.needs_review or bool(sc.review_flags), notes=ev.notes,
                fps=an.media.fps_float, duration_total=an.media.duration,
            ))
    out.sort(key=lambda r: r.scores.total, reverse=True)
    return out
