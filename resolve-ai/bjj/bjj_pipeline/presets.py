"""Stage F - render presets.

Values map 1:1 onto Resolve's `Project.SetRenderSettings` keys and the
Deliver page.  Frame rate is never hard-coded: `for_timeline()` copies the
timeline rate so no frames are invented.  Vertical presets need either a
vertical timeline (recommended: duplicate the timeline and set
1080x1920 in timeline settings) or Smart Reframe (Studio only).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction

from .util import parse_fps

# Resolve 'FormatWidth/FormatHeight' + codec. Codec ids per Resolve scripting README.
@dataclass
class RenderPreset:
    key: str
    label: str
    width: int
    height: int
    format: str                  # mp4 | mov | mxf
    codec: str                   # H264 | H265 | DNxHR | ProRes (Mac only) ...
    quality_note: str
    audio_codec: str = "aac"
    audio_bitrate_kbps: int = 320
    export_video: bool = True
    export_audio: bool = True
    target_bitrate_kbps: int | None = None
    custom_name_suffix: str = ""
    vertical: bool = False
    resolve_settings: dict = field(default_factory=dict)
    manual_steps: list[str] = field(default_factory=list)

    def for_timeline(self, timeline_fps: Fraction | str, out_dir: str, name: str) -> dict:
        fps = parse_fps(timeline_fps)
        settings = {
            "SelectAllFrames": True,
            "TargetDir": out_dir,
            "CustomName": f"{name}{self.custom_name_suffix}",
            "FormatWidth": self.width,
            "FormatHeight": self.height,
            "FrameRate": f"{float(fps):.3f}".rstrip("0").rstrip("."),
            "ExportVideo": self.export_video,
            "ExportAudio": self.export_audio,
            "AudioCodec": self.audio_codec,
            "AudioBitDepth": 24 if self.audio_codec in ("lpcm", "LinearPCM") else 16,
            "AudioSampleRate": 48000,
            "VideoQuality": 0,          # 0 = automatic/best unless target_bitrate is set
        }
        if self.target_bitrate_kbps:
            settings["VideoQuality"] = self.target_bitrate_kbps  # Resolve expects kb/s when > 0
        settings.update(self.resolve_settings)
        return {"format": self.format, "codec": self.codec, "settings": settings}


PRESETS: dict[str, RenderPreset] = {
    "instagram_reel": RenderPreset(
        key="instagram_reel", label="Instagram Reel 1080x1920", width=1080, height=1920, format="mp4", codec="H264",
        quality_note="H.264 High profile, ~12-16 Mb/s, AAC 320k. Instagram re-encodes; keep it clean, not huge.",
        target_bitrate_kbps=14000, custom_name_suffix="_reel", vertical=True,
        manual_steps=["Timeline must be 1080x1920 (duplicate timeline > Timeline Settings > Use Custom Settings > 1080x1920) "
                      "or use Smart Reframe (Studio) on a copy.", "Keep subtitles/titles inside the IG safe zone (top 14 %, bottom 20 %)."]),
    "instagram_story": RenderPreset(
        key="instagram_story", label="Instagram Story 1080x1920", width=1080, height=1920, format="mp4", codec="H264",
        quality_note="Same as Reel; Stories are capped at 60 s per card.", target_bitrate_kbps=12000,
        custom_name_suffix="_story", vertical=True,
        manual_steps=["Vertical timeline required (see instagram_reel).", "Keep each story under 60 s."]),
    "youtube": RenderPreset(
        key="youtube", label="YouTube 1920x1080", width=1920, height=1080, format="mp4", codec="H264",
        quality_note="H.264, 16-24 Mb/s for 1080p (YouTube recommends 8 Mb/s SDR 1080p30, 12 for 60p; headroom helps).",
        target_bitrate_kbps=20000, custom_name_suffix="_youtube"),
    "master": RenderPreset(
        key="master", label="High-quality master (DNxHR HQX 10-bit MOV)", width=1920, height=1080, format="mov", codec="DNxHR HQX",
        quality_note="Intermediate master for archive / re-delivery. ~700 Mb/s at 1080p; use GPU H.265 only if space is critical.",
        audio_codec="lpcm", custom_name_suffix="_master",
        manual_steps=["If the timeline is UHD choose 3840x2160 in the Deliver page instead of 1920x1080."]),
}


def preset(key: str) -> RenderPreset:
    if key not in PRESETS:
        raise KeyError(f"unknown preset {key}; choose from {sorted(PRESETS)}")
    return PRESETS[key]


def describe_all() -> list[dict]:
    return [{"key": p.key, "label": p.label, "resolution": f"{p.width}x{p.height}", "format": p.format, "codec": p.codec,
             "bitrate_kbps": p.target_bitrate_kbps, "vertical": p.vertical, "notes": p.quality_note,
             "manual_steps": p.manual_steps} for p in PRESETS.values()]
