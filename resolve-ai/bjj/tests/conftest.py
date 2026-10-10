"""Synthetic footage fixtures (ffmpeg lavfi). No real athlete footage is ever used in tests."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

FFMPEG = shutil.which("ffmpeg")

pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not installed")


def _ff(*args: str) -> None:
    subprocess.run([FFMPEG, "-v", "error", "-y", "-nostdin", *args], check=True)


@pytest.fixture(scope="session")
def footage(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Three clips that exercise the heuristics deterministically.

    action_60p : static grey background, a box moving fast 8-12 s, loud audio burst 12.5-14 s
                 -> expect action_peak and a celebration_candidate right after
    shaky_25p  : blurred 5-9 s + jitter crop -> expect low stability / review flags
    walkout_30p: nearly static, quiet -> expect low_activity
    """
    if FFMPEG is None:
        pytest.skip("ffmpeg not installed")
    root = tmp_path_factory.mktemp("footage")
    # drawbox does not evaluate `t`; overlay does, so the "athlete" is an overlaid box.
    _ff("-f", "lavfi", "-i", "smptehdbars=s=640x360:r=60:d=20",
        "-f", "lavfi", "-i", "color=c=0x202020:s=180x180:r=60:d=20",
        "-f", "lavfi", "-i", "sine=f=220:d=20",
        "-filter_complex",
        "[0:v][1:v]overlay=x='if(between(t,8,12),50+mod(t*900,400),50)':y='if(between(t,8,12),40+mod(t*700,130),40)':shortest=1[v];"
        "[2:a]volume='if(between(t,12.5,14),8.0,0.02)':eval=frame[a]",
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", str(root / "action_60p.MP4"))
    _ff("-f", "lavfi", "-i", "testsrc=s=640x360:r=25:d=12",
        "-f", "lavfi", "-i", "anoisesrc=d=12:a=0.02",
        "-filter_complex", "[0:v]boxblur=8:2:enable='between(t,5,9)',crop=560:300:'40*sin(t*7)':'30*sin(t*9)',scale=640:360[v]",
        "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", str(root / "shaky_25p.MP4"))
    _ff("-f", "lavfi", "-i", "color=c=0x707070:s=640x360:r=30:d=10",
        "-f", "lavfi", "-i", "color=c=blue:s=60x60:r=30:d=10",
        "-f", "lavfi", "-i", "sine=f=330:d=10",
        "-filter_complex", "[0:v][1:v]overlay=x='200+20*sin(t)':y=150:shortest=1[v];[2:a]volume=0.02[a]",
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22", "-pix_fmt", "yuv420p",
        "-c:a", "aac", str(root / "walkout_30p.MP4"))
    return root


@pytest.fixture(scope="session")
def music(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if FFMPEG is None:
        pytest.skip("ffmpeg not installed")
    p = tmp_path_factory.mktemp("music") / "beat_120.m4a"
    _ff("-f", "lavfi", "-i", "sine=f=110:d=12,volume=0.3", "-f", "lavfi", "-i", "anoisesrc=d=12:a=0.1",
        "-filter_complex", "[1:a]volume='if(lt(mod(t,0.5),0.08),1.0,0.0)':eval=frame[b];[0:a][b]amix=inputs=2[a]",
        "-map", "[a]", "-c:a", "aac", str(p))
    return p
