"""Captions -> ASS subtitles burned in with libass.

Arabic: libass shapes text with HarfBuzz and orders it with FriBidi, so Arabic
letters join correctly and lines read right-to-left without any manual
reshaping.  `bjj studio health` verifies FFmpeg was built with libass,
libharfbuzz and libfribidi.  Fonts: Noto Sans Arabic for Arabic lines and Noto Sans for
Latin lines (both SIL OFL 1.1, bundled in assets/fonts).  Cairo was tried
first and rejected: its variable font drops isolated Arabic letterforms (the
waw/alef in "الدوحة" rendered as boxes) under libass.

Safe areas (vertical 9:16): Reels/TikTok UI covers roughly the bottom 20%
and top 10% of the frame, and the right edge for buttons; captions stay
inside a 10% side margin, above 22% from the bottom and below 12% from the top.
"""
from __future__ import annotations

from pathlib import Path

from .timeline import has_arabic

FONT_DIR = Path(__file__).resolve().parent / "assets" / "fonts"
FONT_LATIN = "Noto Sans"
FONT_ARABIC = "Noto Sans Arabic"
FONT_FILES = ["NotoSans-Variable.ttf", "NotoSansArabic-Variable.ttf"]


def drawtext_font() -> str:
    """`fontfile=...:` prefix for FFmpeg drawtext.  Always explicit: Windows FFmpeg builds without fontconfig
    crash (access violation) when drawtext has to look a font up by itself."""
    p = str(FONT_DIR / "NotoSans-Variable.ttf").replace("\\", "/").replace(":", "\\:")
    return f"fontfile='{p}':"


def _ts(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", "\\N")


def safe_margins(W: int, H: int) -> dict:
    vertical = H > W
    return {
        "side": int(W * 0.10),
        "bottom": int(H * (0.22 if vertical else 0.08)),
        "top": int(H * (0.12 if vertical else 0.07)),
    }


def build_ass(captions: list[dict], W: int, H: int) -> str:
    m = safe_margins(W, H)
    base = H if H > W else int(H * 1.4)            # scale type to the short side for landscape
    sizes = {"title": 0.068, "lower_third": 0.04, "caption": 0.038, "cta": 0.046}   # x frame height (9:16)
    styles = []
    for (role, k), (suffix, font) in [(rk, f) for rk in sizes.items() for f in (("", FONT_LATIN), ("_ar", FONT_ARABIC))]:
        fs = max(18, int(base * k * (1.08 if suffix else 1.0)))     # Arabic x-height is smaller: +8 %
        bold = -1 if role in ("title", "cta") else 0
        # Encoding -1 = libass auto-detects the paragraph base direction (first strong character).  With the
        # default (1) a line like "مبروك للبطل! Blue Belt Media" is laid out LTR and the "!" lands on the wrong side.
        enc = -1 if suffix else 1
        styles.append(f"Style: {role}{suffix},{font},{fs},&H00FFFFFF,&H00FFFFFF,&H00141414,&H96000000,{bold},0,0,0,"
                      f"100,100,0,0,1,{max(2, fs // 14)},{max(1, fs // 28)},2,{m['side']},{m['side']},{m['bottom']},{enc}")
    events = []
    align = {"bottom": 2, "center": 5, "top": 8}
    for c in captions:
        role = c.get("role", "caption") if c.get("role") in sizes else "caption"
        an = align.get(c.get("position", "bottom"), 2)
        mv = m["top"] if an == 8 else m["bottom"]
        text = _escape(c["text"])
        # lang=ar: a leading RLM (U+200F) is the first strong character, so the auto base direction is RTL even
        # when the line starts with Latin ("Blue Belt Media • بطولة قطر") - verified by rendering, see tests.
        style = role
        if c.get("lang") == "ar" or has_arabic(c["text"]):
            text = "\u200f" + text
            style = role + "_ar"
        events.append(f"Dialogue: 0,{_ts(c['start'])},{_ts(c['end'])},{style},,{m['side']},{m['side']},{mv},,"
                      f"{{\\an{an}\\fad(180,160)}}{text}")
    return ("[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\n"
            f"PlayResX: {W}\nPlayResY: {H}\nYCbCr Matrix: TV.709\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
            "MarginL, MarginR, MarginV, Encoding\n" + "\n".join(styles) +
            "\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            + "\n".join(events) + "\n")


def write_ass(captions: list[dict], W: int, H: int, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_ass(captions, W, H), encoding="utf-8")
    return path
