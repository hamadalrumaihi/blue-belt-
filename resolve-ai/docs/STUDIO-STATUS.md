# BBM Studio — status, limits, next actions

Last updated: 2026-10-18, branch `claude/video-studio-2026-10` (base `main` @ f9ca1d0).

## Where it has been verified
| environment | what ran | result |
|---|---|---|
| Cloud Linux session (Ubuntu, FFmpeg 6.1.1 with libass/harfbuzz/fribidi/vidstab/x264, Python 3.13, 2 CPU threads, no GPU) | `pytest` 53 tests (30 existing + 23 studio), full fixture production (ingest → analyze → reference → plan → draft → QC → 2 revision rounds → final export), UI endpoints | all pass |
| H's Windows 11 PC (i7-12700F, RTX 3070 8 GB, 32 GB, Resolve 20.3.1.6 per earlier report) | **not yet** — the PC was linked to the session but the bridge reported it offline, so drives, NVENC and Resolve could not be checked | pending |

All verification media is **synthetic** (FFmpeg lavfi boxes on a mat, tones, noise, a fake
reference). It proves mechanics — indexing, overlap detection, plan rules, rendering, QC detection,
revision evidence, export formats — not that edits of real BJJ footage look good.

## Implemented
- Project folders with schema v1, fingerprinted stage checkpoints, resume, cancel flag, timeouts,
  bounded retries, structured job log, actionable errors (`studio/project.py`, `studio/jobs.py`).
- Ingest: probe, 3-point decode test, sampled content hash, duplicates (unique ids), CFR proxies,
  contact sheets, verified multi-band audio overlap between clips (offset + confidence), groups;
  Arabic/non-ASCII file names; originals verified unchanged in tests.
- Footage understanding: existing heuristics + dense 12 fps shake-compensated movement tracking;
  technical vs editorial scores; reasons; "suggested, unconfirmed" labels.
- Reference breakdown: scdet shots, per-shot camera move + look (ReelMimic method), flashes,
  loudness, beat, structure by thirds, timestamped sheets, derived params; yt-dlp for links if installed.
- Planner: brief-only or reference-guided; lull-based in/out points; event-clock de-duplication of
  multi-camera moments; source interleaving; movement-extent vertical crop or fit-over-blur;
  real-frame slow motion only; selective stabilisation; gamma-only exposure; captions with anchors.
- Timeline bbm-timeline/1 + validation + OTIO (validated by OpenTimelineIO 0.18) + FCPXML 1.9
  (frame-aligned) + CMX3600 EDL (existing writer).
- Renderer: per-clip segment cache (revisions re-render only changed clips), dissolves/dip,
  libass captions (Noto Sans / Noto Sans Arabic, auto-RTL), sidechain-ducked music, two-pass loudnorm
  to -14 LUFS / -1.5 dBTP; draft at half size from proxies, final from originals.
- QC on the rendered file (see STUDIO.md) + evidence sheet + caption frames; reviewer agent format.
- Revisions: timestamped feedback → clip ids, 12 ops, bounded rounds, before/after evidence,
  QC-proposed mechanical fixes (level matching, replace black/repeated shots).
- Export: final MP4, manifest (sources + hashes, tools, QC, revisions), OTIO/FCPXML/EDL, timeline JSON.
- Local UI (`bjj studio ui`, 127.0.0.1): brief with EN/AR captions, footage + reference, run/cancel,
  stages + job log, draft player with clip strip, feedback at current time, op builder, QC table with
  click-to-seek, sheet, revisions, analysis, reference breakdown, export links.
- Health check measured on the machine (FFmpeg flags, real x264 + NVENC encodes, nvidia-smi, OpenCV,
  fonts, disk, Resolve install/connection/edition).
- Windows launcher `resolve-ai/launcher/bbm-studio.cmd` / `.ps1` (uses the existing bjj-pipeline venv).
- Claude: `bbm-studio` + `bbm-studio-dev` skills, six `bbm-*` agents, resolve-ai/CLAUDE.md.

## Known limitations (honest)
- **Windows untested.** PowerShell launcher and paths are written for the existing installer layout
  (`C:\AI-Video-Tools\bin\bjj.cmd`) but have not run on Windows. FFmpeg on Windows must be a full
  build (Gyan.dev "full") for libass + harfbuzz + fribidi + vid.stab; `health` checks this.
- **Resolve**: no live Resolve here. Free edition has no external scripting, so the supported path is
  importing the exported `.otio`/`.fcpxml`/`.edl`. Edition is only known once Resolve connects.
  OTIO/FCPXML were validated structurally (OTIO library, XML parser, frame grid), not imported into
  Resolve 20.3 yet.
- **Footage understanding is signal-level.** Motion/audio/shake/focus/exposure; no pose model, no
  athlete identity, no technique/score recognition (by design: claims must be verifiable).
  Movement extent ≠ athlete bounding boxes; crowded backgrounds (other mats) widen the extent and
  push clips to fit-over-blur.
- **Multi-camera sync** needs shared audio (crowd, referee, slaps); silent or music-only clips are not
  grouped; capture-time groups are low confidence.
- **Reframe is static per clip** (one crop window); no moving crop/keyframed pan yet.
- **Music** is a user-supplied local file; no beat-synced cutting to the music yet (reference beat
  is measured, used only as a parameter); no licensing check.
- **Photos**: one Ken Burns push-in or fit-over-blur; no photo selection/culling logic.
- **Animation / generated assets** (ReelMimic 2D engines, OpenMontage generators): not integrated;
  optional by design and would need consent for any paid provider.
- **Reference links** need yt-dlp; many social links need login → download the file yourself.
- FFmpeg `xfade` dissolves re-encode the whole assembly (fine for social lengths; slow for 10-min fight edits).

## Next actions
1. **On the Windows PC** (blocks real-footage verification): open this chat/branch on the PC (Claude
   desktop app link must be *online*), `git switch claude/video-studio-2026-10`, run
   `resolve-ai\launcher\bbm-studio.cmd -Action setup`, then `bbm-studio.cmd -Action health` and
   paste the JSON. Expect: libass/harfbuzz/fribidi true, `nvenc_test_encode` true, Resolve edition.
2. Run one real production from a tournament card folder; have `bbm-reviewer` review it; record the
   findings here — tune planner thresholds (action threshold, crop margin, lull search) on real
   footage, not fixtures.
3. Import `export/*.otio` into Resolve 20.3; note what links/what does not; fix the exporter.
4. Moving crop (keyframed x over time from the 12 fps track) for long exchanges in 9:16.
5. Optional pose detector (the existing `detect` extra: ultralytics) to bound both athletes properly.
6. Cut-to-beat when a music track is given.

## Resume
`bjj studio status <project>` prints the exact resume command; `bjj studio resume <project>`
continues from the last good checkpoint. In the UI: pick the production and press *Run / resume*.

## Windows setup
```
git switch claude/video-studio-2026-10
resolve-ai\launcher\bbm-studio.cmd -Action setup     # runs install\04-install-analysis.ps1 + OpenCV
resolve-ai\launcher\bbm-studio.cmd -Action health
resolve-ai\launcher\bbm-studio.cmd                   # opens http://127.0.0.1:8765
setx BBM_STUDIO_HOME D:\BBM-Studio                    # optional: keep proxies/renders on a big drive
```
