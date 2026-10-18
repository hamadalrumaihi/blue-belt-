# BBM Studio — integrated video production

One local workflow for Blue Belt Media productions: **ingest → understand footage → (reference
breakdown) → plan an editable timeline → draft render → review the render → revise → export.**
Built on the existing `bjj-pipeline` package (`resolve-ai/bjj`), command `bjj studio ...`.

Status, verified environments and open work: [STUDIO-STATUS.md](STUDIO-STATUS.md).
What came from ReelMimic / agency-agents / OpenMontage and the licences: [UPSTREAM.md](UPSTREAM.md).

## Why this foundation
`bjj-pipeline` already had honest footage heuristics (motion/audio candidates with capped
confidence), ranking, EDL export and a Resolve bridge, in Python with numpy as its only dependency
and with tests. ReelMimic is a Node/React app driving Claude Code agents for 2D animation;
OpenMontage is a large agent-driven tool registry (AGPL-3.0) with no orchestration code. The
simplest maintainable system is therefore: **one Python package, one CLI, one project folder per
production**, adding the missing stages to `bjj-pipeline` and adapting ideas (not three apps).
Agents are Claude Code subagents (`.claude/agents/bbm-*.md`) that call the CLI; they are roles, not
an execution engine.

## Commands
```
bjj studio health                                          measured environment report
bjj studio new "<name>" --brief brief.json                 create a production
bjj studio run <project> --footage <dir>... [--reference <file|url>]
bjj studio resume <project>                                continue from the last good checkpoint
bjj studio status <project>
bjj studio feedback <project> --at 12.4 [--to 14] "text"
bjj studio revise <project> --ops ops.json [--feedback id,id] [--proposed] [--note ".."]
bjj studio render <project> [--final]    bjj studio qc <project>    bjj studio export <project>
bjj studio cancel <project>                                safe stop; resume later
bjj studio ui [--port 8765]                                local web UI on 127.0.0.1
```
Windows: `resolve-ai\launcher\bbm-studio.cmd` (health check, then the UI). Setup:
[STUDIO-STATUS.md › Windows setup](STUDIO-STATUS.md#windows-setup).

## Project folder (one per production, outside git)
Default `%USERPROFILE%\BBM-Studio\projects\<name>` (override `BBM_STUDIO_HOME`).
```
project.json        schema_version 1: brief, sources, settings, stage checkpoints, versions
assets.json         per file: source path, content hash, size/mtime, probe facts, status
                    (ok | duplicate | damaged | unreadable), problems, proxy, contact sheet, groups
cache/index.json    duplicates, same-moment overlaps (offset, per-window agreement, confidence), groups
cache/candidates.json  moments: category, technical vs editorial score, reasons, 12 fps movement track
cache/proxies/      CFR H.264 proxies (long side 1280, GOP 0.5 s)   cache/thumbs/ contact sheets
reference/          breakdown.json, sheets, notes.md (creative director)
timeline/vNNN.json  bbm-timeline/1, append-only versions (parent, history)
renders/            draft_vNNN.mp4 / final_vNNN.mp4; segments/ per-clip cache
qc/                 <render>.json (measurements), <render>/sheet.jpg + caption frames,
                    <render>.review.json (reviewer), feedback.jsonl, proposals/
revisions.jsonl     per round: problems + timestamps, ops, changed clips, before/after evidence
logs/jobs.jsonl     every stage and tool call;  logs/<label>.log raw tool output
export/             final MP4, manifest.json, .otio, .fcpxml, .edl, timeline JSON
CANCEL              present = cancel requested
```

## Stages
| stage | module | what it does | checkpoint fingerprint |
|---|---|---|---|
| ingest | `studio/ingest.py` | discover files/folders; ffprobe; decode-test start/middle/end; sampled content hash; duplicates; CFR proxies; contact sheets; multi-band audio-onset cross-correlation between clips, **verified per 4 s window** (a single shared bang cannot fake an overlap); groups with confidence | file paths + size + mtime |
| analyze | `studio/footage.py` | `bjj analyze` heuristics at 4 fps on proxies (cached per content hash) → `rank`; then 12 fps shake-compensated movement tracking around action/reaction candidates: peak time, movement extent, active ratio; technical vs editorial score; plain-language reasons | asset hashes + weights + ANALYSIS_VERSION |
| reference | `studio/reference.py` | proxy; scdet shots; per-shot camera move + look (ReelMimic method); flashes; loudness; beat; timestamped sheets; derived params (median shot, hook, cut-to-beat, look) | reference hash |
| plan | `studio/planner.py` | brief + candidates (+ params) → timeline v1 with reasons per clip | brief + candidates + overlaps + params |
| render | `studio/render.py` | per-clip segments (trim → vid.stab → eq → speed → fps → reframe) cached by settings; assembly (concat/xfade), ASS captions, music ducked by natural sound, two-pass loudnorm | timeline + quality + size + hashes |
| qc | `studio/qc.py` | measurements on the rendered file, mapped to clip ids + evidence | render entry + file size |
| export | `studio/export.py` | final from originals + QC + manifest + OTIO/FCPXML/EDL | (explicit command) |

A stage is skipped when its fingerprint matches and its outputs exist, so `resume` continues from the
first stage that is missing, failed, cancelled or whose inputs changed. Code changes that alter a
stage's output bump that module's version constant.

## Timeline (bbm-timeline/1)
```json
{"schema": "bbm-timeline/1", "version": 3, "parent": 2, "fps": "30/1", "width": 1080, "height": 1920,
 "format": "vertical",
 "clips": [{"id": "c01", "asset": "8e924e3907e0", "kind": "video", "src_in": 7.4, "src_out": 8.6, "speed": 1.0,
            "role": "hook", "candidate": "8e924e3907e0_000",
            "reframe": {"mode": "crop", "x": 0.58, "w": 0.316, "extent": [0.42, 0.77]},
            "stabilize": false, "color": {"gamma": 1.08, "contrast": 1.0, "saturation": 1.0},
            "audio": {"gain_db": 0.0, "fade_in": 0.04, "fade_out": 0.06},
            "transition_in": {"type": "cut", "duration": 0.0},
            "reason": "hook: strongest action moment; ...", "notes": ["crop follows movement extent ..."]}],
 "captions": [{"id": "t1", "text": "بطولة الدوحة", "lang": "ar", "start": 0.25, "end": 1.85,
               "role": "title", "position": "bottom", "anchor": "start"}],
 "music": null, "audio": {"target_lufs": -14.0, "true_peak_db": -1.5},
 "export": {"vcodec": "libx264", "crf": 18, "preset": "slow", "abitrate": "256k"},
 "reference_params": {}, "notes": [], "history": []}
```
Validation (`timeline.validate`) blocks structural errors and warns about: slow motion without spare
frames, crops cutting off detected movement, sub-0.4 s clips, captions past the end or > 20 chars/s.

## Sports editing rules (planner)
- In/out points move to the quietest moment of the 12 fps movement track near the planned edge; an
  action clip may run up to 2× the target shot length to finish the exchange.
- Same-moment recordings (high-confidence audio overlap) share an "event clock"; overlapping event
  time is never used twice, so two cameras are not presented as two moments.
- Consecutive clips come from different recordings whenever another source is available.
- Vertical: crop window = 9:16 share of the frame centred on the movement extent; if the extent
  (+6 % margins) does not fit, full-width over a blurred fill instead (flagged in notes).
- Real-frame slow motion only when source fps / timeline fps ≥ 2 (60 → 30 = 50 %); 50/60 fps
  sources put the timeline on 25/30.
- Stabilisation only for stability < 40; < 18 is flagged and kept short instead (warp/crop).
- Exposure via gamma only (0.82-1.35), saturation untouched: skin tones stay put.
- Nothing is repeated to pad: if there is not enough distinct material the plan says so.

## Captions (English + Arabic)
libass (via FFmpeg `subtitles`) shapes Arabic with HarfBuzz and orders it with FriBidi. Arabic
lines use Noto Sans Arabic with `Encoding -1` (auto base direction) plus a leading RLM; Latin
lines use Noto Sans. Both fonts are bundled (SIL OFL). Positions stay inside the Reels safe area
(10 % sides, 12 % top, 22 % bottom for 9:16). CTAs are anchored to the end and follow the edit.
Verified visually: joined letters in «الدوحة», "!" on the correct side of «مبروك للبطل!», mixed
«Blue Belt Media • بطولة قطر 2026». Cairo was rejected after it rendered isolated letters as boxes.

## Quality control
Automated (measurements, `qc/<render>.json`): frame size, fps, duration vs timeline, length vs
brief, A/V stream length, full decode, black frames, frozen picture (photo holds excluded),
integrated loudness and true peak, clipping, unintended silence (slow-mo/muted/photo excluded),
level steps at hard cuts (outside the anti-click fades), timeline warnings, repeated and
same-moment shots, cuts landing on peak motion, caption reading speed; plus an evidence sheet
(first/middle/last frame per clip, timestamped) and one frame per caption.
Subjective (`bbm-reviewer` → `qc/<render>.review.json`): brief fit, hook, continuity, framing,
skin/exposure, mix, caption look/Arabic, reference techniques, dignity of minors; each finding with
timestamp, evidence, impact, recommendation; default verdict NEEDS WORK. No overall score exists.

## Revisions
Feedback (`qc/feedback.jsonl`) is mapped to clip ids from the render's layout. Changes are explicit
operations (`.claude/skills/bbm-studio/references/ops.md`) → new timeline version → only changed
segments re-render → QC → `revisions.jsonl` gets the before/after values of every changed check and
where the changed clips now sit. `--proposed` adds QC's mechanical fixes (level matching, replacing
black/repeated shots). Rounds are capped (`settings.max_review_rounds`, default 3).

## Specialists
| agent | inputs | output | acceptance |
|---|---|---|---|
| bbm-creative-director | breakdown + sheets + brief | reference/notes.md | every observation timestamped; nothing copied |
| bbm-footage-selector | candidates, index, dense strips | qc/proposals/footage.json | no identity/technique claims; no same-moment repeats; exchanges complete |
| bbm-audio-captions | QC audio, caption frames | qc/proposals/audio_captions.json | -14 LUFS/-1.5 dBTP; Arabic joined + RTL; safe areas |
| bbm-editor | findings + proposals | ops.json → `bjj studio revise` | single timeline writer; one coherent round |
| bbm-reviewer | render evidence + QC + brief | qc/<render>.review.json | independent; NEEDS WORK by default |
| bbm-reliability | logs, failures | fix + test | measured; version bump when output changes |
Run selector, audio/captions and reviewer in parallel on one render; the editor merges. 2-3 agents
at once on the 32 GB / RTX 3070 PC.

## Resolve
`bjj studio health` reports whether Resolve is installed, whether external scripting connects and
the edition from `GetProductName()` (only knowable when connected). Resolve **Free** does not allow
external scripting, so the tested path is: import `export/*.otio` (or `.fcpxml` / `.edl`) with
*File › Import › Timeline* — clips link to the original media; cuts and speeds come across;
reframe/colour/captions are baked into the rendered MP4 only. With Studio + external scripting the
existing `bjj resolve build --plan ...` bridge can be fed `timeline.to_edit_plan()`; untested here.

## Resource use (RTX 3070 8 GB, 32 GB RAM)
Analysis and rendering are CPU/FFmpeg; `settings.max_workers` defaults to min(4, threads/4). NVENC
is opt-in for the final encode only (`"encoder": "nvenc"` in project.json settings) after health
shows `nvenc_test_encode: true`; one session at a time. No model needs VRAM by default.
