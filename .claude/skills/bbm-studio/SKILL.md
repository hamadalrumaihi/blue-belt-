---
name: bbm-studio
description: >-
  Produce a Blue Belt Media video end to end from real BJJ / judo / MMA / Muay Thai / boxing footage with
  the local BBM Studio pipeline: ingest and index footage, optionally break down a reference video,
  understand the footage, plan an editable timeline, render a draft, review the RENDER, revise from
  timestamped feedback, and export a final 1080x1920 (or landscape/square) video with manifest and
  OTIO/FCPXML/EDL. Use whenever H asks for an athlete highlight, team or gym recap, tournament reel,
  promo, fight edit, "make a reel from this footage", "edit like this reference", "fix the draft at
  0:12", Arabic/English captions on a video, or to resume / check a production - even if he does not
  say "studio". For Resolve-only timeline prep without rendering, the bjj-* skills still apply.
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Bash(ffmpeg *), Bash(ffprobe *), Read, Write, Glob, Grep
---

# BBM Studio — one production, end to end

Arguments: `$ARGUMENTS`

The pipeline lives in `resolve-ai/bjj/bjj_pipeline/studio/` (CLI `bjj studio ...`). Architecture:
`resolve-ai/docs/STUDIO.md`. Current limits: `resolve-ai/docs/STUDIO-STATUS.md`. Read STATUS once
per session so you do not promise something that is not built.

## 0. Where am I running? (always first)
Run `bjj studio health`. It measures this machine: FFmpeg build (libass + harfbuzz + fribidi are
required for Arabic), a real x264 encode, a real NVENC encode, fonts, free disk, and DaVinci Resolve
(installed? connected? edition from the live API). Report only what it measured. A cloud session
cannot see H's Windows drives: if the footage path is a Windows path (`D:\...`) and the session is
not on that PC (or not linked to it), say so and ask him to run it locally (`bbm-studio.cmd`) or
attach clips. Never pretend to have watched footage you cannot open.

## 1. Brief
Turn the request into `brief.json` (schema + examples in `references/brief.md`): kind
(athlete_highlight | team_recap | tournament_reel | promo | fight_edit), title, athletes, target
seconds, format (vertical default), captions with `lang` en/ar, optional music path, flags. Ask only
for what blocks the edit (e.g. caption wording, which athlete). Spell names exactly as H writes them.

## 2. Create or resume
- New: `bjj studio new "<Event - Athlete - Type>" --brief brief.json` → prints the project folder.
- Existing: `bjj studio status <project>` shows stages, versions, open feedback and the resume command.
Projects live in `%USERPROFILE%\BBM-Studio\projects` (or `BBM_STUDIO_HOME`); footage is only read.

## 3. Run the vertical slice
`bjj studio run <project> --footage <dir> [<dir>...] [--reference <file|link>]`
→ ingest (probe, decode-test, hash, proxies, contact sheets, duplicates, same-moment overlaps) →
analyze (motion/audio candidates + 12 fps tracking around peaks) → reference breakdown (if given) →
plan (timeline v001) → draft render (half-res, from proxies) → automated QC.
It is resumable: rerunning skips every stage whose inputs did not change. Long runs: tell H it is
safe to stop (`bjj studio cancel <project>`) and resume later.

Show H: counts from ingest (damaged/duplicate files by name), the overlap groups and their
confidence, and that candidate labels are *suggestions* — the analysis never identifies athletes,
techniques, scores or winners.

## 4. Specialists (parallel where independent; ONE writer of the timeline)
- `bbm-creative-director` — only when there is a reference (or H wants a style direction): writes
  `reference/notes.md`.
- `bbm-footage-selector` — checks selected moments on dense frame strips; proposes ops.
- `bbm-audio-captions` — loudness/level steps/ducking, caption frames (Arabic joined + RTL); proposes ops.
- `bbm-reviewer` — independent review of the RENDER → `qc/<render>.review.json`. Never the same agent
  that edited.
- `bbm-editor` — the only agent that writes the timeline (`bjj studio revise`).
- `bbm-reliability` — when a stage fails or results look wrong.
Footage selector, audio/captions and reviewer can run in parallel on the same render; the editor
merges their proposals. Keep concurrency at 2-3 agents on the 32 GB / 8 GB-VRAM PC.

## 5. Review → revise loop (bounded)
1. Automated QC (`qc/<render>.json`) = measurements: decode, size/fps/duration, A/V length, black and
   frozen frames, loudness/true peak/clipping, unintended silence, level steps at cuts, repeated or
   same-moment shots, cuts on peak motion, caption reading speed. No overall score — never invent one.
2. Subjective review = `bbm-reviewer` after LOOKING at `qc/<render>/sheet.jpg` and caption frames.
   Launch it as a separate subagent (Agent tool: "follow .claude/agents/bbm-reviewer.md; project X;
   render Y") — a reviewer that also made the edit misses what the editor missed. Only if no subagent
   tool exists, review yourself and say plainly that the review is not independent.
3. H's feedback: `bjj studio feedback <project> --at 12.4 [--to 14] "text"` (the UI does this from the
   player's current time). Feedback maps to clip ids automatically.
4. Editor writes `ops.json` (catalog: `references/ops.md`) and runs
   `bjj studio revise <project> --ops ops.json --feedback <ids> --note "round N: ..."`
   (`--proposed` adds QC's mechanical fixes: level matching, replacing black/repeated shots).
   Only changed segments re-render. `revisions.jsonl` records problem, timestamps, change and the
   before/after QC evidence.
5. Max `settings.max_review_rounds` (3). Then stop and list what remains, honestly.

## 6. Export (only when H is happy with the draft)
`bjj studio export <project>` → final render from ORIGINAL media at full size, QC on the final file,
`export/` with the MP4, `manifest.json` (sources + hashes, tools, QC, revisions), `.otio` (Resolve:
File > Import > Timeline), `.fcpxml`, `.edl`, timeline JSON. If originals are offline the export
stops and says which drive to reconnect. Resolve integration beyond importing these files only if
`bjj studio health` shows `resolve.connected: true` (Studio + external scripting); Resolve Free does
not allow external scripting.

## Consent and honesty (non-negotiable)
- Ask before: any paid API/generation job, uploading footage anywhere, publishing/posting.
  Everything above runs locally and needs none of that.
- Footage of children: no humiliating/injury-focused moments as entertainment; no names on minors
  unless H wrote them in the brief.
- Synthetic fixtures prove mechanics only — never present a fixture render as evidence of editing
  quality on real footage.
- Report remaining problems with timestamps rather than calling a draft "perfect".

## Finish
Give H: the draft/final path, what changed in each round (from `revisions.jsonl`), QC counts plus the
reviewer verdict, what is still open, and the resume command.
