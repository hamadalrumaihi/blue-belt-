---
name: bjj-export
description: >-
  Prepare DaVinci Resolve render settings for Blue Belt Media deliverables: Instagram Reel 1080x1920,
  Instagram Story 1080x1920, YouTube 1920x1080, high-quality DNxHR master. Reads the real timeline /
  media frame rate, queues render jobs via the MCP server or the direct bridge, and never starts a
  render without explicit permission. Use for "export presets", "render settings for reels",
  "/bjj-export".
argument-hint: "[--timeline-fps <rate>] [--out-dir <folder>] [--name <base name>] [--plan <plan.json>]"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Read
---

# /bjj-export — render presets

1. Determine the timeline frame rate from the real source: `bjj probe <clips>` (suggested_timeline_fps)
   or, if Resolve is connected, the current timeline setting. Never type a frame rate from memory.
2. `bjj presets --timeline-fps <rate> --name "<base>" --out-dir "<folder>"` -> JSON per preset with
   Resolve `SetRenderSettings` keys (FormatWidth/Height, FrameRate, codec, VideoQuality kb/s, audio).
3. Show the four presets as a table (resolution, codec, bitrate, container, notes). Vertical presets
   require a 1080x1920 timeline (duplicate + Timeline Settings) or Smart Reframe (Studio).
4. Queue (do NOT start): via the MCP server's render tools, or
   `bjj resolve build --plan <plan.json> --project "<project>" --presets instagram_reel,master --render-dir "<folder>"`.
   Only if the user explicitly says "render now" add `--allow-render`.
5. Report the queued jobs, output folder, and the manual_steps the bridge returned.
