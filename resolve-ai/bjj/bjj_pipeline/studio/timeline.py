"""The one authoritative timeline (schema bbm-timeline/1) + validation + NLE exports.

A timeline is plain JSON, versioned (timeline/v001.json, v002.json ...) and never
edited in place: a revision writes a new version whose `parent` is the old one.

Exports for finishing in an NLE (all reference the ORIGINAL media, not proxies):
  * OTIO JSON (.otio)    - DaVinci Resolve 18.5+: File > Import > Timeline
  * FCPXML 1.9 (.fcpxml) - Resolve / Final Cut / Premiere
  * CMX3600 EDL (.edl)   - via the existing bjj_pipeline.export.write_edl
Crop/reframe, stabilisation, colour and captions are baked into the rendered
video; the NLE exports carry cuts, speeds, transitions and notes as markers so
the editor can rebuild the finishing in Resolve if wanted.
"""
from __future__ import annotations

import copy
import time
import unicodedata
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

from ..util import parse_fps, read_json, write_json

SCHEMA = "bbm-timeline/1"
TRANSITIONS = {"cut", "dissolve", "dip_to_black"}
REFRAME_MODES = {"none", "crop", "fit_blur", "fit_pad"}


def has_arabic(s: str) -> bool:
    return any("ARABIC" in unicodedata.name(ch, "") for ch in s)


def record_layout(tl: dict) -> list[tuple[float, float]]:
    """(record_start, record_end) for every clip.  A dissolve of d seconds overlaps the previous clip by d."""
    out = []
    t = 0.0
    for i, c in enumerate(tl["clips"]):
        dur = clip_duration(c)
        tr = c.get("transition_in", {}) or {}
        ov = float(tr.get("duration", 0.0)) if i > 0 and tr.get("type", "cut") == "dissolve" else 0.0
        start = max(0.0, t - ov)
        out.append((round(start, 4), round(start + dur, 4)))
        t = start + dur
    return out


def clip_duration(c: dict) -> float:
    if c.get("kind") == "photo":
        return float(c.get("hold", 2.0))
    return (float(c["src_out"]) - float(c["src_in"])) / max(float(c.get("speed", 1.0)), 1e-6)


def duration(tl: dict) -> float:
    lay = record_layout(tl)
    return lay[-1][1] if lay else 0.0


def reflow_captions(tl: dict) -> list[str]:
    """Keep captions attached to the edit after it changes length.

    anchor="end"   (CTA): keeps its length, ends 0.1 s before the video ends
    anchor="start" (title): unchanged unless it would run past the end
    Any caption past the end is clamped (and dropped if nothing is left)."""
    notes = []
    total = duration(tl) if tl.get("clips") else 0.0
    keep = []
    for c in tl.get("captions", []):
        length = float(c["end"]) - float(c["start"])
        if c.get("anchor") == "end":
            c["end"] = round(max(0.1, total - 0.1), 2)
            c["start"] = round(max(0.0, c["end"] - length), 2)
        if c["end"] > total:
            c["end"] = round(total - 0.05, 2)
            notes.append(f"caption {c['id']} clamped to the video end")
        if c["end"] - c["start"] < 0.5:
            notes.append(f"caption {c['id']} dropped: no room left after the edit changed")
            continue
        keep.append(c)
    tl["captions"] = keep
    return notes


def clip_at(tl: dict, t: float) -> int | None:
    for i, (a, b) in enumerate(record_layout(tl)):
        if a <= t < b:
            return i
    return None


@dataclass
class Issue:
    level: str          # error | warning
    where: str
    message: str


def validate(tl: dict, assets: dict[str, dict] | None = None) -> list[Issue]:
    """Structural + editorial sanity.  Errors block rendering; warnings go to QC."""
    issues: list[Issue] = []
    if tl.get("schema") != SCHEMA:
        issues.append(Issue("error", "timeline", f"schema must be {SCHEMA}"))
    W, H = int(tl.get("width", 0)), int(tl.get("height", 0))
    if W <= 0 or H <= 0 or W % 2 or H % 2:
        issues.append(Issue("error", "timeline", f"bad output size {W}x{H} (must be positive and even)"))
    fps = float(parse_fps(tl.get("fps", "0/1")))
    if fps <= 0:
        issues.append(Issue("error", "timeline", "fps missing"))
    if not tl.get("clips"):
        issues.append(Issue("error", "timeline", "no clips"))
    ids = set()
    for i, c in enumerate(tl.get("clips", [])):
        w = f"clip {i + 1} ({c.get('id')})"
        if c.get("id") in ids:
            issues.append(Issue("error", w, "duplicate clip id"))
        ids.add(c.get("id"))
        if c.get("kind") != "photo":
            a, b = float(c.get("src_in", 0)), float(c.get("src_out", 0))
            if not b > a >= 0:
                issues.append(Issue("error", w, f"src_out ({b}) must be > src_in ({a}) >= 0"))
            sp = float(c.get("speed", 1.0))
            if not 0.2 <= sp <= 4.0:
                issues.append(Issue("error", w, f"speed {sp} outside 0.2..4"))
            if assets and c.get("asset") in assets:
                asset = assets[c["asset"]]
                if b > asset["duration"] + 0.05:
                    issues.append(Issue("error", w, f"src_out {b:.2f}s beyond source duration {asset['duration']:.2f}s"))
                if sp < 1.0 and fps > 0 and asset.get("fps_float", 0) / fps < (1 / sp) - 0.05:
                    issues.append(Issue("warning", w, f"slow motion {sp:.0%} needs {fps / sp:.0f} fps source, "
                                                      f"have {asset['fps_float']:.0f} fps -> frames would be duplicated"))
            if clip_duration(c) < 0.4:
                issues.append(Issue("warning", w, f"very short clip ({clip_duration(c):.2f}s) - may read as a flash"))
        rf = c.get("reframe", {}) or {}
        if rf.get("mode", "none") not in REFRAME_MODES:
            issues.append(Issue("error", w, f"reframe.mode must be one of {sorted(REFRAME_MODES)}"))
        if rf.get("mode") == "crop":
            cw = float(rf.get("w", 1))
            if not 0.05 < cw <= 1.0:
                issues.append(Issue("error", w, f"crop width fraction {cw} invalid"))
            if rf.get("extent"):
                x0, x1 = rf["extent"]
                l = float(rf.get("x", 0.5)) - cw / 2
                if x0 < l - 0.01 or x1 > l + cw + 0.01:
                    issues.append(Issue("warning", w, "crop window cuts off part of the detected movement"))
        tr = c.get("transition_in", {}) or {}
        if tr.get("type", "cut") not in TRANSITIONS:
            issues.append(Issue("error", w, f"transition must be one of {sorted(TRANSITIONS)}"))
        if i > 0 and tr.get("type") == "dissolve":
            prev = tl["clips"][i - 1]
            if float(tr.get("duration", 0)) >= min(clip_duration(c), clip_duration(prev)):
                issues.append(Issue("error", w, "dissolve longer than one of the clips"))
    total = duration(tl) if tl.get("clips") else 0.0
    for k, cap in enumerate(tl.get("captions", [])):
        w = f"caption {k + 1}"
        if not str(cap.get("text", "")).strip():
            issues.append(Issue("error", w, "empty text"))
        s, e = float(cap.get("start", 0)), float(cap.get("end", 0))
        if not e > s >= 0:
            issues.append(Issue("error", w, f"end ({e}) must be > start ({s})"))
        if e > total + 0.05:
            issues.append(Issue("warning", w, f"ends at {e:.2f}s after the video ({total:.2f}s)"))
        if cap.get("lang") == "ar" and not has_arabic(cap.get("text", "")):
            issues.append(Issue("warning", w, "lang=ar but no Arabic letters in text"))
        cps = len(cap.get("text", "")) / max(e - s, 0.01)
        if cps > 20:
            issues.append(Issue("warning", w, f"{cps:.0f} chars/s - too fast to read (aim < 17)"))
    return issues


def new_timeline(*, fps: str, width: int, height: int, fmt: str, name: str) -> dict:
    return {"schema": SCHEMA, "name": name, "version": 0, "parent": None,
            "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "fps": fps, "width": width, "height": height,
            "format": fmt, "clips": [], "captions": [], "music": None,
            "audio": {"target_lufs": -14.0, "true_peak_db": -1.5, "natural_gain_db": 0.0},
            "export": {"vcodec": "libx264", "crf": 18, "preset": "slow", "abitrate": "256k"},
            "notes": [], "reference_params": None}


def save_version(proj, tl: dict, note: str) -> Path:
    tl = copy.deepcopy(tl)
    tl["parent"] = proj.state.get("timeline_version") or None
    v = proj.next_timeline_version()
    tl["version"] = v
    tl["created"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    tl.setdefault("history", []).append({"version": v, "note": note, "at": tl["created"]})
    path = proj.timeline_path(v)
    write_json(path, tl)
    return path


def load(proj, version: int | None = None) -> dict:
    return read_json(proj.timeline_path(version))


# ----------------------------------------------------------------------------- exports

def _rt(seconds: float, rate: float) -> dict:
    return {"OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": round(seconds * rate, 6)}


def to_otio(tl: dict, assets: dict[str, dict]) -> dict:
    rate = float(parse_fps(tl["fps"]))
    children = []
    for c in tl["clips"]:
        a = assets[c["asset"]]
        src_rate = a.get("fps_float") or rate
        if c.get("kind") == "photo":
            sr = {"OTIO_SCHEMA": "TimeRange.1", "start_time": _rt(0, rate), "duration": _rt(clip_duration(c), rate)}
        else:
            sr = {"OTIO_SCHEMA": "TimeRange.1", "start_time": _rt(c["src_in"], src_rate),
                  "duration": _rt(c["src_out"] - c["src_in"], src_rate)}
        effects = []
        if abs(float(c.get("speed", 1.0)) - 1.0) > 1e-6:
            effects.append({"OTIO_SCHEMA": "LinearTimeWarp.1", "name": "speed", "effect_name": "LinearTimeWarp",
                            "time_scalar": float(c["speed"]), "metadata": {}})
        children.append({
            "OTIO_SCHEMA": "Clip.2", "name": c["id"] + " " + Path(a["source"]).name,
            "source_range": sr, "effects": effects, "markers": [], "enabled": True,
            "metadata": {"bbm": {"role": c.get("role"), "reason": c.get("reason"), "reframe": c.get("reframe"),
                                 "candidate": c.get("candidate")}},
            "media_references": {"DEFAULT_MEDIA": {
                "OTIO_SCHEMA": "ExternalReference.1", "name": Path(a["source"]).name,
                "target_url": Path(a["source"]).as_uri(),
                "available_range": {"OTIO_SCHEMA": "TimeRange.1", "start_time": _rt(0, src_rate),
                                    "duration": _rt(a.get("duration") or 0, src_rate)} if a.get("duration") else None,
                "metadata": {}, "available_image_bounds": None}},
            "active_media_reference_key": "DEFAULT_MEDIA",
        })
    track = {"OTIO_SCHEMA": "Track.1", "name": "V1", "kind": "Video", "children": children, "effects": [],
             "markers": [{"OTIO_SCHEMA": "Marker.2", "name": cap["text"][:60], "color": "BLUE", "comment": cap["text"],
                          "metadata": {"lang": cap.get("lang")},
                          "marked_range": {"OTIO_SCHEMA": "TimeRange.1", "start_time": _rt(cap["start"], rate),
                                           "duration": _rt(cap["end"] - cap["start"], rate)}}
                         for cap in tl.get("captions", [])],
             "enabled": True, "metadata": {}, "source_range": None}
    return {"OTIO_SCHEMA": "Timeline.1", "name": tl["name"], "global_start_time": _rt(0, rate),
            "metadata": {"bbm": {"schema": tl["schema"], "version": tl["version"], "format": tl["format"],
                                 "note": "reframe/colour/captions are baked into the rendered MP4; this timeline "
                                         "carries cuts and speeds on ORIGINAL media"}},
            "tracks": {"OTIO_SCHEMA": "Stack.1", "name": "tracks", "children": [track], "effects": [], "markers": [],
                       "enabled": True, "metadata": {}, "source_range": None}}


def _frac(seconds: float, fps: Fraction) -> str:
    """Seconds -> FCPXML rational string snapped to the timeline frame grid ('1001/30000s')."""
    frames = round(seconds * fps)
    f = Fraction(frames) / fps
    return f"{f.numerator}/{f.denominator}s" if f.denominator != 1 else f"{f.numerator}s"


def to_fcpxml(tl: dict, assets: dict[str, dict]) -> str:
    fps = parse_fps(tl["fps"])
    fd = Fraction(1) / fps
    fmt_id = "r1"
    res = [f'<format id="{fmt_id}" name="BBM {tl["width"]}x{tl["height"]}" frameDuration="{fd.numerator}/{fd.denominator}s" '
           f'width="{tl["width"]}" height="{tl["height"]}"/>']
    used = {}
    for c in tl["clips"]:
        if c["asset"] in used:
            continue
        a = assets[c["asset"]]
        rid = f"a{len(used) + 2}"
        used[c["asset"]] = rid
        dur = _frac(a.get("duration") or 10, fps)
        res.append(f'<asset id="{rid}" name="{escape(Path(a["source"]).name)}" start="0s" duration="{dur}" '
                   f'hasVideo="1" hasAudio="{1 if a.get("has_audio") else 0}">'
                   f'<media-rep kind="original-media" src="{escape(Path(a["source"]).as_uri())}"/></asset>')
    spine = []
    offset = 0.0
    for c in tl["clips"]:
        rid = used[c["asset"]]
        d = clip_duration(c)
        start = 0.0 if c.get("kind") == "photo" else float(c["src_in"])
        inner = ""
        sp = float(c.get("speed", 1.0))
        if c.get("kind") != "photo" and abs(sp - 1) > 1e-6:
            src_len = float(c["src_out"]) - float(c["src_in"])
            inner += (f'<timeMap><timept time="0s" value="{_frac(start, fps)}" interp="linear"/>'
                      f'<timept time="{_frac(d, fps)}" value="{_frac(start + src_len, fps)}" interp="linear"/></timeMap>')
        note = escape(f"{c.get('role', '')}: {c.get('reason', '')}"[:240])
        inner += f'<marker start="{_frac(start, fps)}" duration="{_frac(1 / float(fps), fps)}" value="{note}"/>'
        spine.append(f'<asset-clip ref="{rid}" name="{escape(c["id"])}" offset="{_frac(offset, fps)}" '
                     f'start="{_frac(start, fps)}" duration="{_frac(d, fps)}" format="{fmt_id}">{inner}</asset-clip>')
        offset += d          # FCPXML spine is laid out cut-to-cut; dissolves are noted in the clip markers
    total = _frac(offset, fps)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n<resources>'
            + "".join(res) + '</resources>\n<library><event name="BBM Studio">'
            f'<project name="{escape(tl["name"])} v{tl["version"]}"><sequence format="{fmt_id}" duration="{total}" '
            'tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k"><spine>'
            + "".join(spine) + "</spine></sequence></project></event></library>\n</fcpxml>\n")


def to_edit_plan(tl: dict, assets: dict[str, dict]):
    """Convert to the existing bjj_pipeline EditPlan so write_edl / Resolve bridge can be reused unchanged."""
    from ..plan import Cut, EditPlan
    cuts = []
    for i, c in enumerate(tl["clips"], start=1):
        if c.get("kind") == "photo":
            continue
        a = assets[c["asset"]]
        tr = c.get("transition_in", {}) or {}
        cuts.append(Cut(order=i, clip=Path(a["source"]).name, clip_path=a["source"], src_in=float(c["src_in"]),
                        src_out=float(c["src_out"]), speed=float(c.get("speed", 1.0)),
                        transition_in="cross_dissolve" if tr.get("type") == "dissolve" else "cut",
                        transition_frames=int(round(float(tr.get("duration", 0)) * float(parse_fps(tl["fps"])))),
                        role=c.get("role", "action"), notes=str(c.get("reason", ""))[:150]))
    return EditPlan(name=tl["name"], template="studio", timeline_fps=tl["fps"], target_min_s=0, target_max_s=0, cuts=cuts)
