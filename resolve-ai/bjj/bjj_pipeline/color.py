"""/bjj-color helper: consistent treatment plan for tournament footage.

Groups clips by camera hint and exposure, estimates exposure offsets so the
editor (or Resolve's Shot Match) can bring every clip to a common target,
and writes a step list for the Color page.  It never applies grades blindly.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .analyze import ClipAnalysis


@dataclass
class ColorGroup:
    name: str
    camera_hint: str
    clips: list[str] = field(default_factory=list)
    luma_mean: float = 0.0
    clipped_mean: float = 0.0
    suggested_exposure_stops: float = 0.0
    notes: list[str] = field(default_factory=list)


def _stops(luma: float, target: float) -> float:
    # 8-bit luma ~ gamma-encoded; a rough stop estimate from linearised ratio.
    lin = lambda v: (max(v, 1) / 255.0) ** 2.2  # noqa: E731
    return round(math.log2(lin(target) / lin(luma)), 2)


def color_plan(analyses: list[ClipAnalysis], target_luma: float = 115.0) -> dict:
    groups: dict[str, ColorGroup] = {}
    for an in analyses:
        cam = an.media.camera_hint or f"{an.media.width}x{an.media.height}@{an.media.fps_float:.3g}"
        key = cam
        g = groups.setdefault(key, ColorGroup(name=f"group_{len(groups) + 1}", camera_hint=cam))
        g.clips.append(an.media.filename)
        g.luma_mean += an.summary["luma_mean"]
        g.clipped_mean += an.summary["clipped_mean"]
    for g in groups.values():
        n = max(1, len(g.clips))
        g.luma_mean /= n
        g.clipped_mean /= n
        g.suggested_exposure_stops = _stops(g.luma_mean, target_luma)
        if g.clipped_mean > 0.03:
            g.notes.append("highlights clip on >3 % of pixels: pull Gain / use highlight recovery before matching")
        if abs(g.suggested_exposure_stops) > 1.0:
            g.notes.append("exposure differs by more than a stop from target: match with Offset, then re-check skin")
    steps = [
        "Color page > create one Color Group per camera (Clips > right-click > Add into a New Group) using the groups below.",
        "Pick a hero clip per group; balance it (Offset for exposure, Temp/Tint for the venue lighting, mats are usually a strong "
        "neutral-ish reference: avoid letting them drive the white balance).",
        "Shot Match remaining clips in each group to the hero (right-click clip > Shot Match to this Clip), then fix skin tones on the "
        "vectorscope.",
        "Apply the shared look (contrast + saturation + optional LUT) on the Group Post-Clip node so every athlete reads the same.",
        "Vertical reels: check the look at 1080x1920 crop; mats/banners dominate the frame more than in 16:9.",
        "Studio only: AI UltraNR for noisy high-ISO gym footage; Face Refinement sparingly on podium shots.",
    ]
    return {
        "target_luma": target_luma,
        "groups": [g.__dict__ for g in groups.values()],
        "steps": steps,
        "disclaimer": "Exposure offsets are estimates from greyscale analysis of downscaled frames; always confirm on scopes.",
    }
