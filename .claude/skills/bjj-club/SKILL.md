---
name: bjj-club
description: >-
  Prepare a multi-athlete club / team recap (45-90 s, 16:9 YouTube + 9:16 Reel) from analysed
  tournament footage with balanced representation across athletes, team identity title, event
  highlights and a strong ending. Use for "club recap", "team video", "all our athletes from the
  tournament", "/bjj-club".
argument-hint: "<analysis folder> --athletes \"A,B,C\" [--name <recap name>] [--project <new Resolve project>] [--club <club name>]"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Read, Glob
---

# /bjj-club — multi-athlete recap

Arguments: `$ARGUMENTS`. `--athletes` is a comma list matching the athlete folder names used by
`bjj organize` (the plan matches them against clip paths).

1. If the analysis folder covers several athlete folders, confirm every athlete in `--athletes`
   has at least one ranked segment: `bjj rank --analysis <analysis>` and group the output by clip path.
   Report athletes with no usable segment instead of silently leaving them out.
2. Plan: `bjj plan --analysis <analysis> --template club_recap --name "<name>" --athletes "A,B,C" [--review ...]`
   The template interleaves athletes round-robin; show the per-athlete cut count so the user can
   judge balance, and suggest `--include-flagged` if one athlete is under-represented.
3. Build (same three paths as /bjj-reel): MCP server -> `bjj resolve build` -> manual EDL import.
   Title: `<club name> - <tournament> <date>` on the opening cut; closing cut should be a
   celebration/podium moment (the plan picks the strongest reaction as the closer).
4. Presets: `youtube` (1920x1080) + `instagram_reel` (vertical duplicate) + `master`; queue only.
5. End with the athlete-by-athlete list of cuts and anything the editor still has to decide.
