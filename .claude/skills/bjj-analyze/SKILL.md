---
name: bjj-analyze
description: >-
  Analyze Brazilian jiu-jitsu tournament footage (a folder or files) with the local bjj-pipeline and
  produce a reviewable highlight report: per-clip technical stats, candidate moments (motion / audio /
  HypeCut signals) with confidence and suggested BJJ labels, a review.csv for the editor, markers.csv
  and contact sheets. Use when the user says "analyze this footage", "scan the card", "what moments
  are in these clips", "/bjj-analyze <folder>". Never claims to detect submissions; labels are proposals.
argument-hint: "<footage folder or file> [--out <analysis folder>]"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Bash(ffprobe *), Read, Glob, Grep
---

# /bjj-analyze — Stage A-C report

Arguments: `$ARGUMENTS` (first = footage path; optional `--out`; optional `--tournament`, `--date`, `--athlete` to organise first).

1. **Locate the CLI.** Run `bjj doctor --no-resolve`. If it fails, tell the user to run
   `resolve-ai\install\04-install-analysis.ps1` (Windows) and stop.
2. **Probe before anything else**: `bjj probe <path>`. Report true frame rates, resolution,
   duration, audio presence and any `warnings` (variable frame rate). Never assume a frame rate.
3. **Organise only if asked** (`--tournament` + `--date` given):
   `bjj organize <src> --library <lib> --tournament "<name>" --date YYYY-MM-DD --athlete "<a>" --match "<m>" --camera CAM-A --mode copy`
   Originals are copied, never moved. Then analyse the organised `01_Original` folders.
4. **Analyse**: `bjj analyze <path> --out <analysis folder> --contact-sheets [--hypecut]`
   Add `--hypecut` when `bjj doctor` shows a hypecut path. Default `--out` is
   `<footage parent>\_analysis\run-<yyyymmdd-hhmm>`.
5. **Read `report.md`** from the output folder and summarise for the user:
   - clips table (flag soft focus < 40 sharpness, shake p90 > 3.5 px, blown highlights, media warnings)
   - top candidate moments with `kind`, confidence, review flags and suggested labels
   - say explicitly: *"these are heuristic candidates; confirm labels in review.csv"*
6. **Hand-off**: tell the user to open `review.csv`, fill `label`, `keep`, `narrative_1to5`, and then run
   `/bjj-highlights` or `/bjj-reel` with the same analysis folder. Open the contact sheets
   (`contact-sheets\*_events.jpg`) if the user wants a visual check.

Rules: nothing is deleted or excluded automatically; do not upload footage anywhere; do not run
`bjj resolve build` from this skill.
