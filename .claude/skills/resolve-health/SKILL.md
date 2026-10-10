---
name: resolve-health
description: >-
  Check the DaVinci Resolve AI editing setup: Resolve edition/version and whether it is running,
  which davinci-resolve MCP server is active in Claude Code and whether it connects, the direct
  scripting bridge, installed Resolve/BJJ skills, the analysis tools (bjj-pipeline, HypeCut, GPU
  extras), native AI feature availability, installed OFX/VST3 plugins, and what to fix. Use for
  "is Resolve connected", "health check", "/resolve-health".
argument-hint: "[--plugins]"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Bash(claude mcp *), Bash(powershell *), Bash(pwsh *), Read, Glob
---

# /resolve-health

Run these and summarise in one table (component | status | fix):

1. `claude mcp list` and `claude mcp get davinci-resolve` -> active server command + Connected/Failed.
   Map the command path to the implementation (…\davinci-resolve-mcp-gursky = samuelgursky primary,
   …-cipriano = CiprianSpiridon alternate, …-guycochran). If none: `resolve-ai\install\switch-mcp.ps1 -To gursky`.
2. `bjj resolve status` -> direct scripting bridge: edition, version, current project/timeline, hints.
   Free edition: explain that external scripting is Studio-only (Blackmagic restriction, not bypassed);
   EDL import and the analysis pipeline still work.
3. `bjj doctor` -> ffmpeg/ffprobe/numpy/hypecut/ultralytics presence.
4. `bjj resolve ai` -> native AI features for this edition (IntelliSearch 21+, Magic Mask, Smart Reframe,
   Speed Warp, Voice Isolation, auto subtitles, face recognition, scene cut detection, AI colour tools).
5. Skills: list `%USERPROFILE%\.claude\skills` (or `~/.claude/skills`) directories matching
   `bjj-*`, `resolve-*`, `davinci-resolve*`; note that `davinci-resolve*` skills expect the CiprianSpiridon
   server (`switch-mcp.ps1 -To cipriano`), `resolve-*` skills expect the samuelgursky server.
6. With `--plugins` (Windows): `powershell -ExecutionPolicy Bypass -File resolve-ai\install\06-verify.ps1`
   and read `C:\AI-Video-Tools\inventory\verify-latest.md` (OFX: Colourlab Ai; VST3: CrumplePop). After
   installing new plugins, run the `davinci-resolve-generate-plugin-list` skill (needs the CiprianSpiridon server venv).
7. End with the 3 most important fixes, each as an exact command or Resolve menu path.
