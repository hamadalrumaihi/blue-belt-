"""Small shared helpers: ffmpeg discovery, JSON IO, timecode math, logging."""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, is_dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable

LOG = logging.getLogger("bjj")

VIDEO_EXTS = {".mp4", ".mov", ".mxf", ".mts", ".m2ts", ".avi", ".mkv", ".braw", ".r3d", ".m4v", ".insv"}
AUDIO_EXTS = {".wav", ".mp3", ".aac", ".m4a", ".flac", ".aif", ".aiff"}


def setup_logging(verbose: bool = False, log_file: Path | None = None) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)


def which(name: str, env_var: str | None = None) -> str | None:
    """Locate an executable. An explicit env var (e.g. BJJ_FFMPEG) wins over PATH."""
    if env_var and os.environ.get(env_var):
        return os.environ[env_var]
    return shutil.which(name)


def ffmpeg_path() -> str:
    p = which("ffmpeg", "BJJ_FFMPEG")
    if not p:
        raise RuntimeError("ffmpeg not found. Install FFmpeg (winget install Gyan.FFmpeg) or set BJJ_FFMPEG.")
    return p


def ffprobe_path() -> str:
    p = which("ffprobe", "BJJ_FFPROBE")
    if not p:
        raise RuntimeError("ffprobe not found. It ships with FFmpeg; set BJJ_FFPROBE if it is not on PATH.")
    return p


def run(cmd: list[str], *, check: bool = True, capture: bool = True, timeout: int | None = None) -> subprocess.CompletedProcess:
    LOG.debug("run: %s", " ".join(str(c) for c in cmd))
    return subprocess.run(
        [str(c) for c in cmd],
        check=check,
        capture_output=capture,
        text=capture,
        timeout=timeout,
        # On Windows never pop up console windows for ffmpeg.
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def to_jsonable(obj: Any) -> Any:
    if is_dataclass(obj) and not isinstance(obj, type):
        return {k: to_jsonable(v) for k, v in asdict(obj).items()}
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, Fraction):
        return float(obj)
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(v) for v in obj]
    if hasattr(obj, "item") and callable(obj.item):  # numpy scalars
        try:
            return obj.item()
        except Exception:  # pragma: no cover
            return str(obj)
    return obj


def write_json(path: Path, data: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_jsonable(data), indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def iter_media(root: Path, exts: Iterable[str] = VIDEO_EXTS) -> list[Path]:
    exts = {e.lower() for e in exts}
    root = Path(root)
    if root.is_file():
        return [root] if root.suffix.lower() in exts else []
    return sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in exts)


# --- timecode -------------------------------------------------------------

def parse_fps(rate: str | float | Fraction) -> Fraction:
    """'30000/1001' -> Fraction(30000, 1001); 29.97 -> Fraction(30000,1001)."""
    if isinstance(rate, Fraction):
        return rate
    if isinstance(rate, (int, float)):
        # Common NTSC rates written as decimals -> exact 1001 fractions.
        for ntsc in (24000, 30000, 48000, 60000, 120000):
            if abs(float(rate) - ntsc / 1001) < 0.01:
                return Fraction(ntsc, 1001)
        return Fraction(str(rate)).limit_denominator(1000)
    s = str(rate).strip()
    if "/" in s:
        n, d = s.split("/", 1)
        d = d or "1"
        return Fraction(int(n), int(d)) if int(d) else Fraction(0)
    return Fraction(s).limit_denominator(1001)


def is_drop_frame(fps: Fraction) -> bool:
    # 29.97 / 59.94 are conventionally drop-frame in EDLs; 23.976 is not.
    return fps.denominator == 1001 and round(float(fps)) in (30, 60)


def seconds_to_frames(seconds: float, fps: Fraction) -> int:
    return int(round(seconds * float(fps)))


def frames_to_tc(frames: int, fps: Fraction, drop_frame: bool | None = None) -> str:
    """Frames -> HH:MM:SS:FF (or HH:MM:SS;FF for drop-frame). Non-drop maths for NDF."""
    if drop_frame is None:
        drop_frame = is_drop_frame(fps)
    nominal = int(round(float(fps)))
    if nominal <= 0:
        nominal = 25
    if drop_frame and nominal in (30, 60):
        drop = 2 if nominal == 30 else 4
        frames_per_10min = nominal * 600 - drop * 9
        frames_per_min = nominal * 60 - drop
        d = frames // frames_per_10min
        m = frames % frames_per_10min
        if m < drop:
            frames_adj = frames + drop * 9 * d
        else:
            frames_adj = frames + drop * 9 * d + drop * ((m - drop) // frames_per_min)
        sep = ";"
        frames = frames_adj
    else:
        sep = ":"
    ff = frames % nominal
    total_s = frames // nominal
    ss = total_s % 60
    mm = (total_s // 60) % 60
    hh = (total_s // 3600) % 24
    return f"{hh:02d}:{mm:02d}:{ss:02d}{sep}{ff:02d}"


def seconds_to_tc(seconds: float, fps: Fraction) -> str:
    return frames_to_tc(seconds_to_frames(seconds, fps), fps)


def safe_name(s: str, maxlen: int = 80) -> str:
    keep = "-_.() "
    out = "".join(c if (c.isalnum() or c in keep) else "_" for c in s).strip().strip(".")
    out = "_".join(out.split())
    return out[:maxlen] or "untitled"
