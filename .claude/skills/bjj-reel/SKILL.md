---
name: bjj-reel
description: >-
  Prepare a cinematic 15-30 s Instagram Reel (1080x1920) timeline for one athlete from analysed BJJ
  footage: emotional opening, controlled real-frame slow motion, cross dissolves, title, Reel +
  master render presets queued (never started). Builds the timeline in DaVinci Resolve through the
  active davinci-resolve MCP server or the direct scripting bridge, or hands over an EDL when Resolve
  is not reachable. Use for "make a reel", "Instagram reel for <athlete>", "/bjj-reel".
argument-hint: "<analysis folder> --athlete <name> [--name <reel name>] [--project <new Resolve project>] [--music <file>]"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Read, Glob
---

# /bjj-reel — cinematic athlete reel

Arguments: `$ARGUMENTS`.

1. Plan: `bjj plan --analysis <analysis> --template cinematic --name "<name>" --athlete "<athlete>" [--review <analysis>\review.csv] [--music ...]`
   Read the printed JSON: if `duration_s` < 15 say so and offer `--include-flagged`.
2. Check the slow-motion notes in `<name>.cuts.csv` (`speed_note`): 50 % only appears for 50/60 fps
   sources on a 25/30 fps timeline. For 24/25/30 fps sources tell the user slow motion needs Optical
   Flow (Free) or Speed Warp (Studio) and would synthesise frames: ask before planning it.
3. Build in Resolve (pick ONE path, in this order):
   a. **MCP server** (`davinci-resolve`, whichever implementation is active): create a NEW project
      named `<project>` (check the project list first; if it exists use `<project>-2`), import the
      clips from the cut list, import the EDL `<name>.edl` as a timeline, then duplicate the timeline
      and set it to 1080x1920 for the vertical version. Add a Text+ title with the athlete name on
      the opening cut. Queue render jobs from `<name>.render.json` (`instagram_reel`, `master`).
   b. **Direct bridge** if no MCP tool is available: `bjj resolve build --plan <name>.plan.json --project "<project>"`
      (never overwrites; queues renders but does not start them).
   c. **Manual**: Resolve not running / Free edition -> give the exact steps: File > Import > Timeline >
      Pre-Conform EDL, select `<name>.edl`; media must be in the Media Pool first.
4. Vertical framing: Smart Reframe is Studio-only; otherwise set the duplicated timeline to 1080x1920
   and reposition each clip (Inspector > Transform > Position/Zoom) so the athlete stays in frame.
5. Never start rendering. End with: timeline name, project name, what is still manual (speed ramps
   beyond constant 50 %, reframing, music licence), and the render preset summary.
