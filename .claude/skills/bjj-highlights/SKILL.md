---
name: bjj-highlights
description: >-
  Turn a bjj-analyze result into an editable highlight plan: rank the candidate moments (focus, blur,
  stability, composition, subject visibility, action, lighting, narrative, usability), honour the
  editor's review.csv, and build a plan (default: full_highlights 60-120 s, or high_energy /
  cinematic / club_recap) with EDL + cut list + render presets. Use for "make a highlight plan",
  "what should go in the highlights", "/bjj-highlights <analysis folder>".
argument-hint: "<analysis folder> [--template full_highlights|high_energy|cinematic|club_recap] [--name <plan name>] [--music <file>]"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Read, Glob
---

# /bjj-highlights — Stage C-D plan

Arguments: `$ARGUMENTS` (analysis folder from /bjj-analyze; optional `--template`, `--name`, `--music`, `--athlete`, `--include-flagged`).

1. Confirm `<analysis>\analysis.json` exists (else run /bjj-analyze first).
2. If `<analysis>\review.csv` has filled `label`/`keep` columns, pass `--review <analysis>\review.csv`.
   Say which decisions were applied (dropped rows, labels, narrative weights).
3. Rank: `bjj rank --analysis <analysis> [--review ...] [--weights resolve-ai\config\scoring.json]`
   and show the top 10 with scores and review flags. Explain that flagged segments are kept but
   marked; nothing is discarded on action intensity alone.
4. Plan: `bjj plan --analysis <analysis> --template <template> --name "<name>" [--review ...] [--music ...] [--athlete ...]`
   Default template `full_highlights`. Report: number of cuts, total duration vs target, timeline
   frame rate chosen (dominant source rate; 60p footage lands on 30p for clean 50 % slow motion),
   and every `notes` entry (e.g. "under target, include flagged segments").
5. Show the cut list (`<name>.cuts.csv`) as a table: order, role, clip, in/out, speed, transition, labels.
6. Tell the user the deliverables: `<name>.edl` (File > Import > Timeline > Pre-Conform EDL in Resolve),
   `<name>.cuts.csv`, `<name>.plan.json`, `<name>.render.json`; next step `/bjj-reel` (vertical reel) or
   `bjj resolve build --plan <plan.json> --project "<new project>"` to build the timeline.
