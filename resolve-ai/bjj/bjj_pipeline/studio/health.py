"""Environment health check - every claim here is measured on THIS machine, now.

Reports: OS/CPU/RAM/disk, Python, Node, FFmpeg build flags (libass, harfbuzz,
fribidi, vidstab, x264), a real 1-second test encode, NVENC (only if an actual
encode succeeds - the encoder being listed is not enough), nvidia-smi VRAM,
OpenCV (optional), bundled fonts, studio home, and DaVinci Resolve
(installation found? scripting connection? edition from the live API).
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from ..util import which
from .captions import FONT_DIR, FONT_FILES
from .project import studio_home


def _run(cmd: list[str], timeout: int = 60) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, errors="replace",
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:
        return None


def _mem_gb() -> float | None:
    try:
        if os.name == "nt":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS()
            m.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return round(m.ullTotalPhys / 2**30, 1)
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30, 1)
    except Exception:
        return None


def check(resolve: bool = True) -> dict:
    out: dict = {"ok": True, "problems": [], "optional_missing": []}
    out["system"] = {"os": platform.platform(), "machine": platform.machine(), "cpu_threads": os.cpu_count(),
                     "ram_gb": _mem_gb(), "python": sys.version.split()[0], "executable": sys.executable}
    home = studio_home()
    try:
        home.mkdir(parents=True, exist_ok=True)
        du = shutil.disk_usage(home)
        out["studio_home"] = {"path": str(home), "free_gb": round(du.free / 2**30, 1)}
        if du.free < 20 * 2**30:
            out["problems"].append(f"only {du.free / 2**30:.0f} GB free in {home}; proxies + renders need ~20 GB+")
    except OSError as exc:
        out["problems"].append(f"studio home not writable: {home} ({exc})")
    node = which("node")
    out["node"] = (_run([node, "--version"]).stdout.strip() if node and _run([node, "--version"]) else None)
    ff = which("ffmpeg", "BJJ_FFMPEG")
    fp = which("ffprobe", "BJJ_FFPROBE")
    out["ffmpeg"] = {"path": ff, "ffprobe": fp}
    if not ff or not fp:
        out["ok"] = False
        out["problems"].append("FFmpeg/ffprobe not found: winget install Gyan.FFmpeg (full build) or set BJJ_FFMPEG/BJJ_FFPROBE")
        return out
    v = _run([ff, "-hide_banner", "-version"])
    conf = v.stdout if v else ""
    out["ffmpeg"]["version"] = conf.splitlines()[0] if conf else None
    flags = {k: (f"--enable-{k}" in conf) for k in ("libass", "libharfbuzz", "libfribidi", "libfreetype", "libvidstab",
                                                   "libx264", "libfontconfig")}
    out["ffmpeg"]["build"] = flags
    for k in ("libass", "libx264"):
        if not flags[k]:
            out["ok"] = False
            out["problems"].append(f"FFmpeg lacks {k} (required). Use a full build, e.g. Gyan.dev 'full'.")
    if flags["libass"] and not (flags["libharfbuzz"] and flags["libfribidi"]):
        out["problems"].append("FFmpeg libass without harfbuzz/fribidi: Arabic captions will NOT shape/RTL correctly")
    if not flags["libvidstab"]:
        out["optional_missing"].append("libvidstab (stabilisation disabled; clips are flagged instead)")
    # real encodes
    with tempfile.TemporaryDirectory() as td:
        t = Path(td) / "t.mp4"
        r = _run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:d=1", "-c:v", "libx264", str(t)])
        out["ffmpeg"]["x264_test_encode"] = bool(r and r.returncode == 0 and t.exists())
        r = _run([ff, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:d=1", "-c:v", "h264_nvenc",
                  str(Path(td) / "n.mp4")])
        nv = bool(r and r.returncode == 0)
        out["gpu"] = {"nvenc_test_encode": nv,
                      "nvenc_error": None if nv else ((r.stderr.strip().splitlines() or ["not available"])[-1] if r else "n/a")}
    smi = which("nvidia-smi")
    if smi:
        r = _run([smi, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"])
        out["gpu"]["nvidia_smi"] = r.stdout.strip() if r and r.returncode == 0 else None
    else:
        out["gpu"]["nvidia_smi"] = None
    if not out["gpu"]["nvenc_test_encode"]:
        out["optional_missing"].append("NVENC (GPU encode) - CPU x264 is used; set settings.encoder='nvenc' only after this passes")
    try:
        import cv2  # noqa: F401
        out["opencv"] = cv2.__version__
    except Exception:
        out["opencv"] = None
        out["optional_missing"].append("opencv-python-headless (reference camera-move analysis falls back to translation only)")
    out["fonts"] = {f: (FONT_DIR / f).exists() for f in FONT_FILES}
    if not all(out["fonts"].values()):
        out["ok"] = False
        out["problems"].append("bundled caption fonts missing from bjj_pipeline/studio/assets/fonts")
    out["yt_dlp"] = which("yt-dlp")
    if not out["yt_dlp"]:
        out["optional_missing"].append("yt-dlp (reference LINKS; local reference files work without it)")
    if resolve:
        out["resolve"] = resolve_report()
    return out


def resolve_report() -> dict:
    from ..resolve_bridge import _paths, status
    api, lib = _paths()
    rep = {"installed": lib.exists(), "scripting_lib": str(lib), "api_dir_exists": api.exists()}
    if not lib.exists():
        rep["summary"] = "DaVinci Resolve not found on this machine (expected on the Windows editing PC)."
        rep["edition"] = None
        return rep
    st = status()
    rep.update(connected=st.connected, product=st.product, version=st.version, edition=st.edition or "unknown",
               error=st.error, hints=st.hints)
    if st.connected:
        rep["summary"] = f"{st.product} {st.version} connected - scripting works from this process."
    else:
        rep["summary"] = ("Resolve is installed but external scripting did not connect. Resolve Free does not allow "
                          "external scripting; import the exported .otio/.fcpxml/.edl with File > Import > Timeline.")
    return rep
