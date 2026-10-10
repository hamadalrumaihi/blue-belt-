# Resolve-AI — Blue Belt Media's AI-assisted DaVinci Resolve editing environment

Everything needed to install, integrate and run an AI-assisted Brazilian jiu-jitsu editing
workflow on the Windows 10 editing PC (RTX 3070, i7-12700F, 32 GB), driven from Claude Code.

```
resolve-ai/
  install/          Windows PowerShell installers (idempotent, backups first, no admin needed)
    install-all.ps1     00 inventory -> 01 backup -> 02 MCP servers -> 03 skills -> 04 analysis -> 05 (skip) -> 06 verify
    switch-mcp.ps1      make ONE Resolve MCP server active in Claude Code (gursky | cipriano | guycochran)
  bjj/              bjj-pipeline Python package: organize, analyze, rank, plan, EDL/CSV/JSON export,
                    Resolve scripting bridge, render presets (30 tests, synthetic footage)
  launcher/         bbm-video.cmd / .ps1 central launcher (status, health, analyze, plan, build, presets, logs)
  config/           scoring.json (ranking weights)
  docs/             REPORT.md (final report + status table), SKILLS-CATALOG.md, MANUAL-STEPS.md,
                    NATIVE-AI.md, COMMERCIAL-PLUGINS.md, UNINSTALL-UPDATE.md, WORKFLOW.md
../.claude/skills/  bjj-analyze, bjj-highlights, bjj-reel, bjj-club, bjj-cleanup, bjj-color, bjj-export, resolve-health
```

## Quick start (on the Windows PC)

```powershell
git clone https://github.com/hamadalrumaihi/blue-belt- C:\BlueBelt\blue-belt      # or pull main
# easiest: double-click  C:\BlueBelt\blue-belt\resolve-ai\install\install.cmd   (window stays open)
# or, from an open PowerShell window:
powershell -ExecutionPolicy Bypass -File C:\BlueBelt\blue-belt\resolve-ai\install\install-all.ps1
# optional GPU extras (CUDA torch + YOLO pose + whisper, ~3 GB):  ... install-all.ps1 -WithGpuExtras
```

If the installer stops with red text, the window now stays open and the same text is in
`C:\AI-Video-Tools\logs\install-<date>.log`. Paste the red lines to Claude (`/resolve-health` reads the log).

Then open DaVinci Resolve **Studio**, set *Preferences > System > General > External scripting using = Local*,
open a new terminal and run `bbm-video` (launcher) or start Claude Code and type `/resolve-health`.

Everything lands under `C:\AI-Video-Tools\` (override with `$env:AI_VIDEO_TOOLS`). Nothing is installed
system-wide; each tool has its own `uv` virtual environment. See `docs/REPORT.md` for the full picture.
