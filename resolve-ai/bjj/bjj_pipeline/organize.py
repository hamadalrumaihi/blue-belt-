"""Stage A - import and organise footage.

Library layout (every level is optional except tournament/date):

  <Library>/
    <YYYY-MM-DD>_<Tournament>/
      _music/                      optional music tracks
      _analysis/                   JSON reports, EDLs, contact sheets, logs
      <Athlete>/
        <Match>/
          <Camera>/
            01_Original/           copied (or hard-linked) originals, names untouched
            02_Selected/           sub-clips the editor approves (never originals)
            03_Exports/            renders

Originals are copied or hard-linked - NEVER moved and NEVER deleted.
"""
from __future__ import annotations

import hashlib
import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .media import MediaInfo, probe
from .util import AUDIO_EXTS, LOG, VIDEO_EXTS, iter_media, safe_name, write_json

LIBRARY_SUBDIRS = ("01_Original", "02_Selected", "03_Exports")


@dataclass
class OrganizeOptions:
    library: Path
    tournament: str
    date: str                       # YYYY-MM-DD
    athlete: str = "_unassigned"
    match: str = "_unassigned"
    camera: str = "CAM-A"
    mode: str = "copy"              # copy | hardlink | symlink | dry-run
    checksum: bool = False          # sha256 every file (slow but bullet-proof)
    music: Path | None = None


@dataclass
class OrganizedClip:
    original: str
    destination: str
    size_bytes: int
    sha256: str | None
    media: dict | None
    athlete: str
    match: str
    camera: str


@dataclass
class OrganizeManifest:
    created: str
    library_root: str
    tournament_dir: str
    tournament: str
    date: str
    mode: str
    clips: list[OrganizedClip] = field(default_factory=list)
    music: list[str] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)


def _sha256(path: Path, chunk: int = 4 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def tournament_dir(library: Path, date: str, tournament: str) -> Path:
    datetime.strptime(date, "%Y-%m-%d")  # validate early
    return Path(library) / f"{date}_{safe_name(tournament)}"


def _place(src: Path, dst: Path, mode: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        if dst.stat().st_size == src.stat().st_size:
            LOG.info("exists, unchanged: %s", dst)
            return
        raise FileExistsError(f"{dst} exists with a different size; refusing to overwrite")
    if mode == "dry-run":
        LOG.info("[dry-run] %s -> %s", src, dst)
        return
    if mode == "hardlink":
        try:
            os.link(src, dst)
            return
        except OSError as exc:  # different volume etc. -> fall back to copy
            LOG.warning("hardlink failed (%s); copying instead", exc)
    if mode == "symlink":
        os.symlink(src, dst)
        return
    shutil.copy2(src, dst)


def organize(source: Path, opts: OrganizeOptions) -> OrganizeManifest:
    source = Path(source)
    tdir = tournament_dir(opts.library, opts.date, opts.tournament)
    manifest = OrganizeManifest(
        created=datetime.now().isoformat(timespec="seconds"),
        library_root=str(Path(opts.library).resolve()),
        tournament_dir=str(tdir.resolve()) if tdir.exists() or opts.mode != "dry-run" else str(tdir),
        tournament=opts.tournament,
        date=opts.date,
        mode=opts.mode,
    )
    if opts.mode != "dry-run":
        (tdir / "_analysis").mkdir(parents=True, exist_ok=True)

    clip_dir = tdir / safe_name(opts.athlete) / safe_name(opts.match) / safe_name(opts.camera)
    if opts.mode != "dry-run":
        for sub in LIBRARY_SUBDIRS:
            (clip_dir / sub).mkdir(parents=True, exist_ok=True)

    for src in iter_media(source, VIDEO_EXTS):
        dst = clip_dir / "01_Original" / src.name
        try:
            info: MediaInfo | None = probe(src)
        except Exception as exc:  # unreadable file: record and keep going
            LOG.warning("probe failed for %s: %s", src, exc)
            manifest.skipped.append({"file": str(src), "reason": f"probe failed: {exc}"})
            continue
        _place(src, dst, opts.mode)
        manifest.clips.append(
            OrganizedClip(
                original=str(src.resolve()),
                destination=str(dst),
                size_bytes=src.stat().st_size,
                sha256=_sha256(src) if opts.checksum else None,
                media=info.__dict__ if info else None,
                athlete=opts.athlete,
                match=opts.match,
                camera=opts.camera,
            )
        )

    if opts.music:
        mdir = tdir / "_music"
        for m in iter_media(opts.music, AUDIO_EXTS):
            _place(m, mdir / m.name, opts.mode)
            manifest.music.append(str(mdir / m.name))

    if opts.mode != "dry-run":
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        write_json(tdir / "_analysis" / f"import-manifest_{stamp}.json", manifest)
    LOG.info("organised %d clips into %s (%d skipped)", len(manifest.clips), clip_dir, len(manifest.skipped))
    return manifest
