"""Adapters for third-party tool outputs.

HypeCut  (https://github.com/Yu-0312/hypecut, Apache-2.0)
    `hypecut cut|analyze` writes `<name>.hypecut.json` with `segments[]` carrying
    start/end/score/reasons.  We turn each segment into an Event so it can be
    ranked and planned together with our own heuristics.  HypeCut also writes a
    CMX3600 EDL on `cut`; we keep that file as-is and additionally emit a
    marker CSV from the JSON (HypeCut's EDL has no scores).

video-ad-editor (https://github.com/majedphotos/video-ad-editor, MIT)
    Not installed as a plugin (see docs/REPORT.md).  If the user runs it
    anyway, its `<work>/cut.json` ({"keep": [[in,out],...]}) and
    `<work>/caps.json` become an EditPlan + SRT here, so the result can be
    imported into Resolve as an EDL instead of only a rendered MP4.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from fractions import Fraction

from .analyze import Event, HEURISTIC_MAX_CONF
from .media import MediaInfo, probe
from .plan import Cut, EditPlan
from .util import LOG, which

HYPECUT_KIND = "detector:hypecut"


def hypecut_events(sidecar: Path, media: MediaInfo | None = None) -> list[Event]:
    data = json.loads(Path(sidecar).read_text(encoding="utf-8"))
    src = Path(data.get("source", "")).name or (media.filename if media else "unknown")
    events: list[Event] = []
    for seg in data.get("segments", []):
        reasons: dict = seg.get("reasons", {}) or {}
        top = sorted(reasons.items(), key=lambda kv: -abs(float(kv[1])))[:3]
        score = float(seg.get("score", 0.0))
        meta = seg.get("meta", {}) or {}
        labels = ["intense_exchange", "crowd_reaction", "celebration"]
        if any(k in ("crowd_roar", "audio_rms", "audio_transient") for k, _ in top):
            labels = ["crowd_reaction", "celebration", "coach_reaction", "intense_exchange"]
        if any(k in ("motion", "scene_change") for k, _ in top):
            labels = ["intense_exchange", "scramble", "takedown", "sweep"] + labels
        events.append(Event(
            clip=src, start=float(seg["start"]), end=float(seg["end"]), kind=HYPECUT_KIND,
            score=min(1.0, score), confidence=min(HEURISTIC_MAX_CONF, 0.3 + 0.4 * min(1.0, score)),
            suggested_labels=list(dict.fromkeys(labels)), source="hypecut",
            notes="HypeCut: " + ", ".join(f"{k} z={float(v):.2f}" for k, v in top),
            extra={"peak_time": meta.get("peak_time"), "event_start": meta.get("event_start"),
                   "event_end": meta.get("event_end"), "rank": meta.get("rank"), "hypecut_score": score},
        ))
    return events


def hypecut_available(python: str | None = None) -> str | None:
    """Return the hypecut executable (or a venv python) if installed, else None."""
    if python and Path(python).exists():
        return python
    env = which("hypecut", "BJJ_HYPECUT")
    return env


def run_hypecut_analyze(video: Path, out_json: Path, profile: Path | None = None, exe: str | None = None) -> Path | None:
    exe = exe or hypecut_available()
    if not exe:
        LOG.info("hypecut not installed; skipping (install with resolve-ai/install/04-install-analysis.ps1)")
        return None
    cmd = [exe]
    if Path(exe).name.lower().startswith("python"):
        cmd += ["-I", "-m", "hypecut"]
    cmd += ["analyze", str(video), "--json", str(out_json), "-q"]
    if profile:
        cmd += ["--profile", str(profile)]
    out_json.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=3600,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        LOG.warning("hypecut failed on %s: %s", video.name, getattr(exc, "stderr", exc))
        return None
    return out_json


class HypecutDetector:
    """Detector plug-in: runs `hypecut analyze` and converts its segments."""

    name = "hypecut"

    def __init__(self, work_dir: Path, profile: Path | None = None, exe: str | None = None):
        self.work_dir = Path(work_dir)
        self.profile = profile
        self.exe = exe

    def detect(self, media: MediaInfo, frames, audio) -> list[Event]:  # noqa: ANN001 (protocol)
        out = self.work_dir / f"{Path(media.filename).stem}.hypecut.json"
        if not out.exists():
            if run_hypecut_analyze(Path(media.path), out, self.profile, self.exe) is None:
                return []
        return hypecut_events(out, media)


# --- video-ad-editor -----------------------------------------------------------

def video_ad_editor_plan(work_dir: Path, source: Path | None = None, name: str = "video-ad-editor cut") -> EditPlan:
    work_dir = Path(work_dir)
    cut = json.loads((work_dir / "cut.json").read_text(encoding="utf-8"))
    src = source or next((p for p in work_dir.glob("src.*")), None)
    if src is None:
        raise FileNotFoundError("source video not given and <work>/src.* not found")
    media = probe(src)
    fps = Fraction(media.fps)
    plan = EditPlan(name=name, template="video_ad_editor", timeline_fps=f"{fps.numerator}/{fps.denominator}",
                    target_min_s=0, target_max_s=float(cut.get("total", 0)), cuts=[])
    for i, (a, b) in enumerate(cut.get("keep", []), start=1):
        plan.cuts.append(Cut(order=i, clip=media.filename, clip_path=media.path, src_in=float(a), src_out=float(b),
                             role="action", labels=["speech"], notes="from video-ad-editor cut.json (silence-removed)"))
    plan.notes.append("captions: see caps.json -> use `bjj adapters vae-srt` to write an SRT for Resolve's subtitle track")
    return plan


def video_ad_editor_srt(work_dir: Path, out: Path) -> Path:
    caps = json.loads((Path(work_dir) / "caps.json").read_text(encoding="utf-8"))

    def ts(t: float) -> str:
        ms = int(round(t * 1000))
        h, ms = divmod(ms, 3_600_000)
        m, ms = divmod(ms, 60_000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    lines = []
    for i, card in enumerate(caps.get("cards", []), start=1):
        text = " ".join(w.get("t", "") for w in card.get("w", [])) or card.get("text", "")
        lines += [str(i), f"{ts(float(card['s']))} --> {ts(float(card['e']))}", text, ""]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines), encoding="utf-8")
    return out
