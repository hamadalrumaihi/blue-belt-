---
name: bjj-color
description: >-
  Prepare a consistent colour treatment for tournament footage: group clips by camera and exposure,
  estimate exposure offsets, and lay out the Color-page workflow (color groups, hero clip balance,
  Shot Match, shared look on the group post-clip node) plus the AI colour tools available in the
  detected Resolve edition. Use for "match the colours", "consistent look across cameras",
  "/bjj-color".
argument-hint: "<analysis folder> [--target-luma 115]"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Read
---

# /bjj-color — consistent treatment plan

1. `bjj color --analysis <analysis> [--out <analysis>\color-plan.json]` -> groups + exposure offsets + steps.
2. `bjj resolve ai` -> which native AI colour tools exist (Studio: AI UltraNR, Face Refinement, Depth Map, Relight; Free: Color Warper, HDR palette, Color Slice).
3. Present: one table of groups (camera hint, clips, mean luma, suggested offset in stops, notes) and the
   numbered Color-page steps. Mats are not a white-balance reference; use skin / white gi / banners.
4. If the active davinci-resolve MCP server is connected and the timeline exists, you may create the
   colour groups and assign clips (project color groups API) — ask first; never apply LUTs or
   grades blindly. Offsets are estimates from greyscale analysis; confirm on scopes.
5. Deliver: the plan file path, the step list, and which steps are GUI-only.
