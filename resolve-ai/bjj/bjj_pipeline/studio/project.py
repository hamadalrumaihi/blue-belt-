"""Project state: one folder per production, versioned schema, stage checkpoints.

Layout (all paths relative to the project dir)::

    project.json          brief, settings, stage checkpoints  (schema_version)
    assets.json           asset index (source path, hash, probe, proxy, groups)
    cache/proxies/        CFR H.264 analysis/draft proxies (never the originals)
    cache/thumbs/         contact sheets
    cache/analysis/       per-asset analysis JSON (keyed by content hash)
    reference/            reference breakdown + editing params
    timeline/vNNN.json    every timeline version ever produced (append-only)
    renders/              draft_vNNN.mp4 / final_vNNN.mp4 + per-clip segment cache
    qc/                   automated QC + review JSON per render
    revisions.jsonl       problem / timestamps / change / evidence per revision
    logs/jobs.jsonl       structured job log;  logs/*.log  raw tool output
    export/               final video, manifest, EDL, FCPXML, OTIO-style JSON
    CANCEL                touch this file to cancel the running job

Originals are only ever *read*.  Footage never lives inside the git repo:
projects default to ~/BBM-Studio/projects (override with BBM_STUDIO_HOME).
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from . import SCHEMA_VERSION
from ..util import read_json, safe_name, to_jsonable, write_json

STAGES = ["ingest", "analyze", "reference", "plan", "render", "qc", "export"]

FORMATS = {
    "vertical": (1080, 1920),
    "landscape": (1920, 1080),
    "square": (1080, 1080),
}
DRAFT_SCALE = 0.5          # draft renders at half resolution (540x960 for vertical)

BRIEF_KINDS = ["athlete_highlight", "team_recap", "tournament_reel", "promo", "fight_edit"]


def studio_home() -> Path:
    return Path(os.environ.get("BBM_STUDIO_HOME") or (Path.home() / "BBM-Studio"))


@dataclass
class Caption:
    text: str
    lang: str = "en"                 # "en" | "ar"
    start: float | None = None       # timeline seconds; None = planner decides
    end: float | None = None
    position: str = "bottom"         # top | center | bottom (inside safe area)
    role: str = "title"              # title | lower_third | caption | cta


@dataclass
class Brief:
    kind: str = "athlete_highlight"
    title: str = ""
    athletes: list[str] = field(default_factory=list)
    target_seconds: float = 30.0
    format: str = "vertical"
    fps: str | None = None            # None = derived from footage
    captions: list[Caption] = field(default_factory=list)
    music: str | None = None
    music_gain_db: float = -18.0
    natural_sound: bool = True
    allow_slowmo: bool = True
    allow_stabilize: bool = True
    keep_chronology: bool = False     # fight edits keep source order
    notes: str = ""
    mode: str = "footage"             # footage | animation (optional ReelMimic route, not implemented locally)

    @staticmethod
    def from_dict(d: dict) -> "Brief":
        d = dict(d or {})
        caps = [Caption(**c) if isinstance(c, dict) else c for c in d.pop("captions", []) or []]
        known = {k: v for k, v in d.items() if k in Brief.__dataclass_fields__}
        b = Brief(**known)
        b.captions = caps
        if b.kind not in BRIEF_KINDS:
            raise ValueError(f"brief.kind must be one of {BRIEF_KINDS}, got {b.kind!r}")
        if b.format not in FORMATS:
            raise ValueError(f"brief.format must be one of {sorted(FORMATS)}, got {b.format!r}")
        return b


def fingerprint(*parts: Any) -> str:
    """Stable hash of JSON-able inputs -> decides whether a stage must re-run."""
    blob = json.dumps(to_jsonable(parts), sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def file_hash(path: Path, full: bool = False, chunk: int = 4 << 20) -> str:
    """Content hash.  Default: size + first/middle/last 4 MB (fast on 20 GB files,
    collision-safe enough for duplicate detection).  full=True hashes everything."""
    path = Path(path)
    h = hashlib.sha256()
    size = path.stat().st_size
    h.update(str(size).encode())
    with path.open("rb") as f:
        if full or size <= 3 * chunk:
            while True:
                b = f.read(chunk)
                if not b:
                    break
                h.update(b)
        else:
            for off in (0, size // 2, size - chunk):
                f.seek(off)
                h.update(f.read(chunk))
    return ("full:" if full or size <= 3 * chunk else "sample:") + h.hexdigest()[:24]


class Project:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.state_path = self.root / "project.json"
        self.state: dict = read_json(self.state_path) if self.state_path.exists() else {}
        if self.state:
            self._migrate()

    # ---- creation / persistence ------------------------------------------
    @classmethod
    def create(cls, name: str, brief: Brief | dict | None = None, parent: Path | None = None) -> "Project":
        parent = Path(parent) if parent else studio_home() / "projects"
        root = parent / safe_name(name)
        if (root / "project.json").exists():
            raise FileExistsError(f"project already exists: {root} (use `bjj studio resume {root}`)")
        b = brief if isinstance(brief, Brief) else Brief.from_dict(brief or {"title": name})
        p = cls(root)
        p.state = {
            "schema_version": SCHEMA_VERSION,
            "name": name,
            "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "brief": asdict(b),
            "sources": [],
            "reference": None,
            "settings": {"draft_scale": DRAFT_SCALE, "max_workers": default_workers()},
            "stages": {},
            "timeline_version": 0,
            "render_version": 0,
            "review_round": 0,
        }
        for d in ("cache/proxies", "cache/thumbs", "cache/analysis", "reference", "timeline", "renders/segments",
                  "qc", "logs", "export"):
            (root / d).mkdir(parents=True, exist_ok=True)
        p.save()
        return p

    def _migrate(self) -> None:
        v = int(self.state.get("schema_version", 0))
        if v > SCHEMA_VERSION:
            raise RuntimeError(f"project schema v{v} is newer than this tool (v{SCHEMA_VERSION}); update bbm-studio")
        # v0 -> v1 placeholder: nothing shipped before v1.
        self.state["schema_version"] = SCHEMA_VERSION

    def save(self) -> None:
        tmp = self.state_path.with_suffix(".json.tmp")
        write_json(tmp, self.state)
        os.replace(tmp, self.state_path)       # atomic on Windows and POSIX

    # ---- paths ------------------------------------------------------------
    def p(self, *parts: str) -> Path:
        q = self.root.joinpath(*parts)
        q.parent.mkdir(parents=True, exist_ok=True)
        return q

    @property
    def brief(self) -> Brief:
        return Brief.from_dict(self.state["brief"])

    def set_brief(self, brief: Brief | dict) -> None:
        b = brief if isinstance(brief, Brief) else Brief.from_dict(brief)
        self.state["brief"] = asdict(b)
        self.save()

    # ---- assets -----------------------------------------------------------
    @property
    def assets(self) -> list[dict]:
        f = self.root / "assets.json"
        return read_json(f) if f.exists() else []

    def save_assets(self, assets: list[dict]) -> None:
        tmp = self.root / "assets.json.tmp"
        write_json(tmp, assets)
        os.replace(tmp, self.root / "assets.json")

    def asset(self, asset_id: str) -> dict:
        for a in self.assets:
            if a["id"] == asset_id:
                return a
        raise KeyError(asset_id)

    # ---- stage checkpoints ------------------------------------------------
    def stage(self, name: str) -> dict:
        return self.state.setdefault("stages", {}).get(name, {})

    def stage_is_current(self, name: str, fp: str) -> bool:
        st = self.stage(name)
        # The fingerprint captures every input; "stale" is only a display hint set by upstream changes.
        if st.get("status") not in ("done", "stale") or st.get("fingerprint") != fp:
            return False
        return all((self.root / o).exists() for o in st.get("outputs", []))

    def mark(self, name: str, status: str, *, fp: str | None = None, outputs: list[str] | None = None,
             error: str | None = None, **extra: Any) -> None:
        st = self.state.setdefault("stages", {}).setdefault(name, {})
        st["status"] = status
        st["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        if fp is not None:
            st["fingerprint"] = fp
        if outputs is not None:
            st["outputs"] = [str(Path(o).relative_to(self.root)) if Path(o).is_absolute() else str(o) for o in outputs]
        st["error"] = error
        st.update(extra)
        self.save()

    def invalidate_from(self, name: str) -> None:
        """Mark `name` and every later stage stale (inputs changed upstream)."""
        if name not in STAGES:
            return
        for s in STAGES[STAGES.index(name):]:
            st = self.state.get("stages", {}).get(s)
            if st and st.get("status") == "done":
                st["status"] = "stale"
        self.save()

    # ---- cancellation -----------------------------------------------------
    @property
    def cancel_flag(self) -> Path:
        return self.root / "CANCEL"

    def cancelled(self) -> bool:
        return self.cancel_flag.exists()

    def request_cancel(self) -> None:
        self.cancel_flag.write_text(time.strftime("%Y-%m-%dT%H:%M:%S"), encoding="utf-8")

    def clear_cancel(self) -> None:
        if self.cancel_flag.exists():
            self.cancel_flag.unlink()

    # ---- timeline versions ------------------------------------------------
    def timeline_path(self, version: int | None = None) -> Path:
        v = self.state.get("timeline_version", 0) if version is None else version
        return self.root / "timeline" / f"v{v:03d}.json"

    def next_timeline_version(self) -> int:
        self.state["timeline_version"] = int(self.state.get("timeline_version", 0)) + 1
        self.save()
        return self.state["timeline_version"]

    def summary(self) -> dict:
        return {
            "project": str(self.root),
            "name": self.state.get("name"),
            "schema_version": self.state.get("schema_version"),
            "brief_kind": self.state.get("brief", {}).get("kind"),
            "assets": len(self.assets),
            "timeline_version": self.state.get("timeline_version"),
            "render_version": self.state.get("render_version"),
            "review_round": self.state.get("review_round"),
            "stages": {k: v.get("status") for k, v in self.state.get("stages", {}).items()},
            "cancel_requested": self.cancelled(),
        }


def default_workers() -> int:
    """Concurrency for CPU-bound analysis.  ffmpeg is itself multi-threaded, so
    stay well under the core count (12700F: 20 threads -> 4 workers)."""
    n = os.cpu_count() or 2
    return max(1, min(4, n // 4 or 1))


def open_project(path: Path | str) -> Project:
    p = Project(Path(path))
    if not p.state:
        raise FileNotFoundError(f"no project.json in {path}")
    return p
