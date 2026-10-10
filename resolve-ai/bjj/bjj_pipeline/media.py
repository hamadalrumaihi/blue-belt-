"""Media probing with ffprobe.

Never assume frame rates: every downstream stage (EDL timecodes, retime limits,
render presets) reads the values probed here.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

from .util import ffprobe_path, parse_fps, run


@dataclass
class MediaInfo:
    path: str
    filename: str
    duration: float
    width: int
    height: int
    fps: str                 # rational string e.g. "60000/1001" (JSON friendly)
    fps_float: float
    codec: str
    pix_fmt: str
    bit_rate: int | None
    nb_frames: int | None
    has_audio: bool
    audio_codec: str | None
    audio_sample_rate: int | None
    audio_channels: int | None
    start_timecode: str | None
    creation_time: str | None
    rotation: int
    size_bytes: int
    is_vertical: bool
    camera_hint: str | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def fps_fraction(self) -> Fraction:
        return parse_fps(self.fps)

    @property
    def is_high_frame_rate(self) -> bool:
        """>= 50 fps: can be conformed to 50% speed at 25/30 fps without inventing frames."""
        return self.fps_float >= 49.0

    def max_clean_slowmo_factor(self, timeline_fps: float) -> float:
        """Largest slow-motion factor that still uses only real frames.

        e.g. 120 fps source on a 30 fps timeline -> 4.0 (25% speed).
        A 30 fps source on a 30 fps timeline -> 1.0 (no clean slow motion; use
        Optical Flow / Speed Warp if the user accepts synthesized frames).
        """
        if timeline_fps <= 0:
            return 1.0
        return max(1.0, round(self.fps_float / timeline_fps, 3))


def probe(path: Path | str) -> MediaInfo:
    path = Path(path)
    cmd = [
        ffprobe_path(), "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    res = run(cmd, timeout=120)
    data = json.loads(res.stdout or "{}")
    fmt = data.get("format", {})
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    warnings: list[str] = []
    if v is None:
        raise ValueError(f"No video stream in {path}")

    # Prefer r_frame_rate; fall back to avg_frame_rate. Warn when they differ
    # (variable frame rate phone footage) because retiming such clips is risky.
    r_rate = parse_fps(v.get("r_frame_rate", "0/1"))
    avg_rate = parse_fps(v.get("avg_frame_rate", "0/1"))
    fps = r_rate if r_rate > 0 else avg_rate
    if r_rate > 0 and avg_rate > 0 and abs(float(r_rate) - float(avg_rate)) > 0.5:
        warnings.append(
            f"variable frame rate suspected (r={float(r_rate):.3f}, avg={float(avg_rate):.3f}); "
            "transcode to constant frame rate before retiming"
        )

    rotation = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            try:
                rotation = int(sd["rotation"]) % 360
            except (TypeError, ValueError):
                pass
    tags = v.get("tags", {}) or {}
    if not rotation and "rotate" in tags:
        try:
            rotation = int(tags["rotate"]) % 360
        except ValueError:
            pass

    width, height = int(v.get("width", 0)), int(v.get("height", 0))
    if rotation in (90, 270):
        width, height = height, width

    duration = float(fmt.get("duration") or v.get("duration") or 0.0)
    nb_frames = v.get("nb_frames")
    try:
        nb_frames = int(nb_frames) if nb_frames not in (None, "N/A") else None
    except ValueError:
        nb_frames = None

    start_tc = tags.get("timecode") or (fmt.get("tags", {}) or {}).get("timecode")
    creation = (fmt.get("tags", {}) or {}).get("creation_time") or tags.get("creation_time")
    camera = (fmt.get("tags", {}) or {}).get("com.apple.quicktime.model") or (fmt.get("tags", {}) or {}).get("encoder")

    br = fmt.get("bit_rate")
    try:
        br = int(br) if br else None
    except ValueError:
        br = None

    return MediaInfo(
        path=str(path.resolve()),
        filename=path.name,
        duration=duration,
        width=width,
        height=height,
        fps=f"{fps.numerator}/{fps.denominator}",
        fps_float=float(fps),
        codec=v.get("codec_name", "unknown"),
        pix_fmt=v.get("pix_fmt", "unknown"),
        bit_rate=br,
        nb_frames=nb_frames,
        has_audio=a is not None,
        audio_codec=a.get("codec_name") if a else None,
        audio_sample_rate=int(a["sample_rate"]) if a and a.get("sample_rate") else None,
        audio_channels=int(a["channels"]) if a and a.get("channels") else None,
        start_timecode=start_tc,
        creation_time=creation,
        rotation=rotation,
        size_bytes=int(fmt.get("size") or path.stat().st_size),
        is_vertical=height > width,
        camera_hint=camera,
        warnings=warnings,
    )


def dominant_fps(infos: list[MediaInfo]) -> Fraction:
    """Most common frame rate across clips -> sensible timeline frame rate."""
    counts: dict[str, int] = {}
    for i in infos:
        counts[i.fps] = counts.get(i.fps, 0) + 1
    if not counts:
        return Fraction(25)
    best = max(counts.items(), key=lambda kv: kv[1])[0]
    f = parse_fps(best)
    # High frame rate footage (50/60/120) is normally cut on a 25/30 timeline so
    # slow motion uses real frames. Choose the base rate by region convention.
    if float(f) >= 49:
        base = Fraction(25) if round(float(f)) in (50, 100) else parse_fps("30000/1001") if f.denominator == 1001 else Fraction(30)
        return base
    return f
