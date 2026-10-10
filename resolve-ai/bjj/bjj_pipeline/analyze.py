"""Stage B - footage analysis (local, CPU-friendly, GPU optional).

What this module honestly does
------------------------------
It measures *signals* from the pixels and the audio and turns them into
time-stamped **candidate events** with a confidence score and a list of
*suggested* BJJ labels for a human to confirm.  It does NOT classify
takedowns / sweeps / submissions; no off-the-shelf model we evaluated is
trained for grappling.  The event taxonomy below is the target vocabulary
the reviewer picks from (see docs/WORKFLOW.md "Human review").

Signals (per sampled frame, default 4 fps at 256 px wide, greyscale):
  * motion         mean absolute frame difference               -> action intensity
  * camera_shift   phase-correlation global translation (px)     -> stability / pan
  * sharpness      Laplacian variance                            -> focus
  * luma / clipped exposure and blown highlights                 -> lighting
  * center_edges   edge density in the centre third              -> subject visibility / composition proxy
  * hist_delta     greyscale histogram change                    -> in-camera scene cuts
Audio (mono 16 kHz): RMS loudness per 250 ms -> crowd / coach reactions.

Optional detectors (plug-ins) can add richer events: a HypeCut adapter
(reads HypeCut's exported results) and a YOLO-pose detector (persons on the
mat, standing vs. ground).  Both are opt-in and never required.
"""
from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Protocol

import numpy as np

from .media import MediaInfo, probe
from .util import LOG, ffmpeg_path

# --- BJJ target vocabulary ---------------------------------------------------
BJJ_LABELS = [
    "takedown", "sweep", "submission", "guard_pass", "scramble", "back_take",
    "celebration", "walkout", "coach_reaction", "crowd_reaction", "intense_exchange",
    "stalling", "referee_call", "podium", "warmup", "b_roll", "unknown",
]

# Heuristic reliability ceilings: a heuristic can never be more confident than this.
HEURISTIC_MAX_CONF = 0.70


@dataclass
class FrameMetrics:
    t: float
    motion: float
    camera_shift: float
    sharpness: float
    luma: float
    clipped: float
    center_edges: float
    hist_delta: float


@dataclass
class AudioMetrics:
    t: float
    rms_db: float


@dataclass
class Event:
    clip: str
    start: float
    end: float
    kind: str                       # action_peak | crowd_reaction | celebration_candidate | scene_cut | low_activity | detector:<name>
    score: float                    # 0..1 normalised intensity
    confidence: float               # 0..1, capped for heuristics
    suggested_labels: list[str]
    needs_review: bool = True
    source: str = "heuristic"
    notes: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass
class ClipAnalysis:
    media: MediaInfo
    frames: list[FrameMetrics]
    audio: list[AudioMetrics]
    events: list[Event]
    per_second: list[dict]          # aggregated 1 s bins (motion, shake, sharpness, audio_db, action)
    summary: dict


class Detector(Protocol):
    name: str

    def detect(self, media: MediaInfo, frames: list[FrameMetrics], audio: list[AudioMetrics]) -> list[Event]: ...


# --- frame + audio extraction -------------------------------------------------

def iter_gray_frames(path: Path, sample_fps: float = 4.0, width: int = 256) -> Iterator[tuple[float, np.ndarray]]:
    """Yield (timestamp, grey uint8 HxW) frames decoded by ffmpeg at reduced size."""
    # Probe just the dimensions to compute the scaled height (keeps even sizes).
    info = probe(path)
    height = max(2, int(round(width * info.height / max(info.width, 1) / 2)) * 2)
    cmd = [
        ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path),
        "-vf", f"fps={sample_fps},scale={width}:{height}:flags=area,format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    LOG.debug("frames: %s", " ".join(cmd))
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    frame_bytes = width * height
    i = 0
    assert proc.stdout is not None
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            yield i / sample_fps, np.frombuffer(buf, dtype=np.uint8).reshape(height, width)
            i += 1
    finally:
        proc.stdout.close()
        proc.wait()


def read_audio_rms(path: Path, window_s: float = 0.25, sr: int = 16000) -> list[AudioMetrics]:
    cmd = [ffmpeg_path(), "-v", "error", "-nostdin", "-i", str(path), "-vn",
           "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    try:
        res = subprocess.run(cmd, capture_output=True, check=True,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.CalledProcessError:
        return []
    pcm = np.frombuffer(res.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if pcm.size == 0:
        return []
    n = int(sr * window_s)
    out: list[AudioMetrics] = []
    for k in range(0, pcm.size - n + 1, n):
        seg = pcm[k:k + n]
        rms = float(np.sqrt(np.mean(seg * seg)) + 1e-9)
        out.append(AudioMetrics(t=k / sr, rms_db=20 * math.log10(rms)))
    return out


# --- per-frame maths (numpy only) ---------------------------------------------

def laplacian_var(g: np.ndarray) -> float:
    f = g.astype(np.float32)
    lap = (-4 * f[1:-1, 1:-1] + f[:-2, 1:-1] + f[2:, 1:-1] + f[1:-1, :-2] + f[1:-1, 2:])
    return float(lap.var())


def edge_density(g: np.ndarray) -> float:
    f = g.astype(np.float32)
    gx = np.abs(np.diff(f, axis=1))
    gy = np.abs(np.diff(f, axis=0))
    return float((gx.mean() + gy.mean()) / 2.0)


def center_edge_ratio(g: np.ndarray) -> float:
    h, w = g.shape
    c = g[h // 3: 2 * h // 3, w // 3: 2 * w // 3]
    whole = edge_density(g) + 1e-6
    return float(edge_density(c) / whole)


def phase_shift(prev: np.ndarray, cur: np.ndarray, size: tuple[int, int] = (36, 64)) -> float:
    """Global translation magnitude (in small-image pixels) via phase correlation."""
    def small(a: np.ndarray) -> np.ndarray:
        h, w = a.shape
        ys = np.linspace(0, h - 1, size[0]).astype(int)
        xs = np.linspace(0, w - 1, size[1]).astype(int)
        s = a[np.ix_(ys, xs)].astype(np.float32)
        return s - s.mean()
    a, b = small(prev), small(cur)
    fa, fb = np.fft.fft2(a), np.fft.fft2(b)
    cross = fa * np.conj(fb)
    cross /= (np.abs(cross) + 1e-6)
    corr = np.abs(np.fft.ifft2(cross))
    peak = np.unravel_index(int(np.argmax(corr)), corr.shape)
    dy = peak[0] if peak[0] <= size[0] // 2 else peak[0] - size[0]
    dx = peak[1] if peak[1] <= size[1] // 2 else peak[1] - size[1]
    return float(math.hypot(dx, dy))


def hist_delta(prev: np.ndarray, cur: np.ndarray) -> float:
    hp, _ = np.histogram(prev, bins=32, range=(0, 255))
    hc, _ = np.histogram(cur, bins=32, range=(0, 255))
    hp = hp / max(hp.sum(), 1)
    hc = hc / max(hc.sum(), 1)
    return float(np.abs(hp - hc).sum() / 2.0)   # 0..1


def compute_frame_metrics(path: Path, sample_fps: float = 4.0, width: int = 256) -> list[FrameMetrics]:
    out: list[FrameMetrics] = []
    prev: np.ndarray | None = None
    for t, g in iter_gray_frames(path, sample_fps, width):
        if prev is None:
            motion = shift = hd = 0.0
        else:
            diff = np.abs(g.astype(np.int16) - prev.astype(np.int16))
            motion = float(diff.mean())
            shift = phase_shift(prev, g)
            hd = hist_delta(prev, g)
        out.append(FrameMetrics(
            t=t, motion=motion, camera_shift=shift, sharpness=laplacian_var(g),
            luma=float(g.mean()), clipped=float((g >= 250).mean()),
            center_edges=center_edge_ratio(g), hist_delta=hd,
        ))
        prev = g
    return out


# --- aggregation + heuristic events -----------------------------------------

def _norm(x: np.ndarray, lo_pct: float = 5, hi_pct: float = 95) -> np.ndarray:
    if x.size == 0:
        return x
    lo, hi = np.percentile(x, lo_pct), np.percentile(x, hi_pct)
    if hi - lo < 1e-6:
        return np.zeros_like(x)
    return np.clip((x - lo) / (hi - lo), 0, 1)


def aggregate_per_second(frames: list[FrameMetrics], audio: list[AudioMetrics], duration: float) -> list[dict]:
    n = max(1, int(math.ceil(duration)))
    bins: list[dict] = []
    fm = np.array([[f.t, f.motion, f.camera_shift, f.sharpness, f.luma, f.clipped, f.center_edges] for f in frames]) if frames else np.zeros((0, 7))
    am = np.array([[a.t, a.rms_db] for a in audio]) if audio else np.zeros((0, 2))
    for s in range(n):
        sel = fm[(fm[:, 0] >= s) & (fm[:, 0] < s + 1)] if fm.size else fm
        asel = am[(am[:, 0] >= s) & (am[:, 0] < s + 1)] if am.size else am
        bins.append({
            "t": s,
            "motion": float(sel[:, 1].mean()) if sel.size else 0.0,
            "shake": float(sel[:, 2].mean()) if sel.size else 0.0,
            "sharpness": float(sel[:, 3].mean()) if sel.size else 0.0,
            "luma": float(sel[:, 4].mean()) if sel.size else 0.0,
            "clipped": float(sel[:, 5].mean()) if sel.size else 0.0,
            "center_edges": float(sel[:, 6].mean()) if sel.size else 0.0,
            "audio_db": float(asel[:, 1].mean()) if asel.size else -90.0,
        })
    # Action score = motion (dominant) + audio lift above the clip's own baseline.
    # Motion uses an ABSOLUTE scale (mean |frame diff| in 8-bit units at 256 px,
    # sampled 4x/s): ~0-1 static, 3-8 people moving, 10+ scrambles / pans.  A
    # per-clip percentile scale would turn a static clip's noise into "action".
    motion = 1.0 - np.exp(-np.array([b["motion"] for b in bins]) / 8.0)
    audio_db = np.array([b["audio_db"] for b in bins])
    base = np.median(audio_db) if audio_db.size else -90.0
    audio_lift = np.clip((audio_db - base) / 12.0, 0, 1) if audio_db.size else np.zeros(len(bins))
    for i, b in enumerate(bins):
        b["motion_norm"] = float(motion[i]) if motion.size else 0.0
        b["audio_lift"] = float(audio_lift[i])
        b["action"] = float(0.75 * b["motion_norm"] + 0.25 * b["audio_lift"])
    return bins


def _segments(mask: np.ndarray, min_len: int, gap: int) -> list[tuple[int, int]]:
    """Runs of True in mask, merging gaps <= gap, keeping runs >= min_len (in bins)."""
    segs: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            segs.append((start, i))
            start = None
    if start is not None:
        segs.append((start, len(mask)))
    merged: list[tuple[int, int]] = []
    for s in segs:
        if merged and s[0] - merged[-1][1] <= gap:
            merged[-1] = (merged[-1][0], s[1])
        else:
            merged.append(s)
    return [s for s in merged if s[1] - s[0] >= min_len]


class HeuristicDetector:
    """Motion / audio / cut heuristics -> candidate events (always available)."""

    name = "heuristic"

    def __init__(self, action_threshold: float = 0.55, min_event_s: int = 2, merge_gap_s: int = 1,
                 audio_spike_db: float = 8.0, pad_s: float = 1.5):
        self.action_threshold = action_threshold
        self.min_event_s = min_event_s
        self.merge_gap_s = merge_gap_s
        self.audio_spike_db = audio_spike_db
        self.pad_s = pad_s

    def detect(self, media: MediaInfo, frames: list[FrameMetrics], audio: list[AudioMetrics]) -> list[Event]:
        bins = aggregate_per_second(frames, audio, media.duration)
        if not bins:
            return []
        action = np.array([b["action"] for b in bins])
        audio_db = np.array([b["audio_db"] for b in bins])
        base = float(np.median(audio_db))
        events: list[Event] = []
        dur = media.duration

        def clamp(a: float, b: float) -> tuple[float, float]:
            return max(0.0, a), min(dur, b)

        # 1. action peaks (intense exchanges, possible scoring moments)
        for s, e in _segments(action >= self.action_threshold, self.min_event_s, self.merge_gap_s):
            peak = float(action[s:e].max())
            st, en = clamp(s - self.pad_s, e + self.pad_s)
            events.append(Event(
                clip=media.filename, start=st, end=en, kind="action_peak", score=peak,
                confidence=min(HEURISTIC_MAX_CONF, 0.35 + 0.5 * peak),
                suggested_labels=["intense_exchange", "scramble", "takedown", "sweep", "guard_pass", "submission"],
                notes="High motion energy. Could be a takedown/sweep/pass/sub attempt or just a scramble - review.",
            ))
        # 2. crowd / coach reactions (audio spikes)
        spike = audio_db >= base + self.audio_spike_db
        for s, e in _segments(spike, 1, 1):
            lift = float((audio_db[s:e].max() - base) / (self.audio_spike_db * 2))
            st, en = clamp(s - 1.0, e + 2.0)
            # a spike right after an action peak smells like a celebration / score
            # the action event is padded by pad_s, so "right after" includes its padded tail
            after_action = any(ev.kind == "action_peak" and -(self.pad_s + 1.0) <= s - ev.end <= 6 for ev in events)
            events.append(Event(
                clip=media.filename, start=st, end=en,
                kind="celebration_candidate" if after_action else "crowd_reaction",
                score=min(1.0, lift),
                confidence=min(HEURISTIC_MAX_CONF, 0.3 + 0.3 * min(1.0, lift) + (0.1 if after_action else 0)),
                suggested_labels=(["celebration", "crowd_reaction", "coach_reaction", "referee_call"]
                                  if after_action else ["crowd_reaction", "coach_reaction", "referee_call", "walkout"]),
                notes=f"Audio {audio_db[s:e].max() - base:.1f} dB above clip median.",
            ))
        # 3. in-camera scene cuts (hist delta spikes) - useful for multi-shot clips
        for f in frames:
            if f.hist_delta >= 0.45:
                events.append(Event(
                    clip=media.filename, start=f.t, end=f.t, kind="scene_cut", score=f.hist_delta,
                    confidence=min(HEURISTIC_MAX_CONF, f.hist_delta), suggested_labels=["b_roll"],
                    needs_review=False, notes="Hard visual change (camera cut or whip pan).",
                ))
        # 4. long low-activity stretches (walkouts, stalling, podium)
        for s, e in _segments(action <= 0.12, 8, 2):
            st, en = clamp(s, e)
            events.append(Event(
                clip=media.filename, start=st, end=en, kind="low_activity", score=float(1 - action[s:e].mean()),
                confidence=0.4, suggested_labels=["walkout", "stalling", "podium", "warmup", "b_roll"],
                notes="Little motion/audio. Possibly walkout, stalling or ceremony - usable as B-roll.",
            ))
        events.sort(key=lambda ev: ev.start)
        return events


# --- public API -------------------------------------------------------------

def analyze_clip(path: Path, detectors: list[Detector] | None = None, sample_fps: float = 4.0,
                 width: int = 256) -> ClipAnalysis:
    path = Path(path)
    media = probe(path)
    LOG.info("analyzing %s (%.1fs, %dx%d @ %.3f fps)", path.name, media.duration, media.width, media.height, media.fps_float)
    frames = compute_frame_metrics(path, sample_fps, width)
    audio = read_audio_rms(path) if media.has_audio else []
    detectors = detectors or [HeuristicDetector()]
    events: list[Event] = []
    for det in detectors:
        try:
            found = det.detect(media, frames, audio)
            for ev in found:
                ev.source = det.name
            events.extend(found)
        except Exception as exc:  # a broken optional detector must not kill the run
            LOG.warning("detector %s failed on %s: %s", getattr(det, "name", det), path.name, exc)
    events.sort(key=lambda ev: (ev.start, ev.kind))
    per_second = aggregate_per_second(frames, audio, media.duration)
    summary = summarize(media, frames, audio, events, per_second)
    return ClipAnalysis(media=media, frames=frames, audio=audio, events=events, per_second=per_second, summary=summary)


def summarize(media: MediaInfo, frames: list[FrameMetrics], audio: list[AudioMetrics], events: list[Event], bins: list[dict]) -> dict:
    sharp = np.array([f.sharpness for f in frames]) if frames else np.zeros(1)
    shake = np.array([f.camera_shift for f in frames]) if frames else np.zeros(1)
    motion = np.array([f.motion for f in frames]) if frames else np.zeros(1)
    luma = np.array([f.luma for f in frames]) if frames else np.zeros(1)
    clipped = np.array([f.clipped for f in frames]) if frames else np.zeros(1)
    action = np.array([b["action"] for b in bins]) if bins else np.zeros(1)
    return {
        "duration": media.duration,
        "fps": media.fps_float,
        "resolution": f"{media.width}x{media.height}",
        "vertical": media.is_vertical,
        "sharpness_median": float(np.median(sharp)),
        "sharpness_p10": float(np.percentile(sharp, 10)),
        "shake_median_px": float(np.median(shake)),
        "shake_p90_px": float(np.percentile(shake, 90)),
        "motion_mean": float(motion.mean()),
        "luma_mean": float(luma.mean()),
        "clipped_mean": float(clipped.mean()),
        "action_mean": float(action.mean()),
        "action_peak": float(action.max()),
        "seconds_above_threshold": int((action >= 0.55).sum()),
        "events": {k: sum(1 for e in events if e.kind == k) for k in sorted({e.kind for e in events})},
        "media_warnings": list(media.warnings),
    }
