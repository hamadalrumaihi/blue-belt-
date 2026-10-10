# Manual steps (things only you can do in DaVinci Resolve or Windows)

## Before the first run
1. **Install prerequisites** (per-user, no admin): Git (`winget install Git.Git`), Python 3.12 x64 from python.org with *py launcher* ticked (uv can also download it), FFmpeg (`winget install Gyan.FFmpeg`), Claude Code. The installer installs `uv` itself.
2. **Clone or pull this repository** to e.g. `C:\BlueBelt\blue-belt` (the same place the capture agent uses) and run
   `powershell -ExecutionPolicy Bypass -File C:\BlueBelt\blue-belt\resolve-ai\install\install-all.ps1`.
3. Read `C:\AI-Video-Tools\inventory\inventory-latest.md`. Fix listed conflicts.

### If the installer window shows red text and closes
Run `resolve-ai\install\install.cmd` (double-click) or run `install-all.ps1` from an already-open PowerShell
window, so the message stays on screen; it is also written to `C:\AI-Video-Tools\logs\install-<date>.log`.
Common causes: Git or Python missing (install them, re-run), Windows PowerShell blocking scripts downloaded
as a ZIP (right-click each `.ps1` > Properties > *Unblock*, or clone with git instead of downloading a ZIP),
or no internet for `git clone` / `uv`. The inventory step alone never changes anything:
`install-all.ps1 -InventoryOnly`.

## In DaVinci Resolve
4. **Edition.** `Help > About`. External scripting is a **Studio** feature. On the Free edition every MCP server and `bjj resolve build` will report "Resolve did not accept the connection"; the analysis, plans, EDL/CSV exports and render presets still work and you import the EDL by hand (step 8).

   **Free edition (detected on this PC: Resolve 20.3 Free) — the in-app bridge.** The primary MCP server ships a
   script that runs *inside* Resolve from its own Scripts menu, which Blackmagic did not gate on the Free
   edition through 21.0.x, and re-exports the live scripting object to the MCP server over an authenticated
   localhost listener. The installer puts it in `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility\`
   and writes its secret to `%USERPROFILE%\.config\davinci-resolve-mcp\bridge.json`. To use it, every session:
   1. start Resolve and open (or create) a project;
   2. `Workspace > Scripts > resolve_bridge` (a console window may flash; leave Resolve open);
   3. `claude mcp list` should now show `davinci-resolve … Connected`, and `bjj resolve status` reports the edition.
   If `resolve_bridge` is missing from the menu, Resolve could not find a Python 3: install python.org Python 3.x
   for this user (the inventory found 3.13.1, which should work), restart Resolve. If a `.py` never appears but a
   `.lua` canary does, your build has removed Python from the Free edition (21.1+): Studio is then required.
   This uses Resolve's supported internal scripting; nothing bypasses licensing. Re-run the bridge installer after
   a Resolve update: `C:\AI-Video-Tools\mcp\davinci-resolve-mcp-gursky\.venv\Scripts\python.exe scripts\install_resolve_bridge.py`.
   Step 5 (External scripting = Local) is still worth setting; it is harmless on Free and needed on Studio.
5. **Enable scripting:** `DaVinci Resolve > Preferences > System > General > External scripting using: Local` → Save → restart Resolve. Keep it *Local* (never *Network*; nothing here needs a network port).
6. **Open or create a project** before running Claude. `bjj resolve build --project NAME` creates a new project and appends `-2`, `-3`… if the name exists; it never overwrites.
7. **Project frame rate** is set automatically from the footage when a new project is created; for an existing project check `Project Settings > Master Settings > Timeline frame rate` matches `suggested_timeline_fps` from `bjj probe`. Never let Resolve conform 60p to 60p if you want real-frame slow motion; cut 60p on a 30p (or 25p) timeline.
8. **Import an EDL manually:** add the source clips to the Media Pool (`File > Import > Media`), then `File > Import > Timeline > Pre-Conform EDL…`, pick `<plan>.edl`, confirm the frame rate shown. Clips are matched by name (`* FROM CLIP NAME`) and source timecode.
9. **Speed ramps and transitions:** constant 50 %/25 % speed arrives via the EDL `M2` lines. Ramps (`Retime Controls > Add Speed Point`), Speed Warp (Studio) / Optical Flow, and anything but cross dissolves are yours: yellow/cyan markers mark the spots.
10. **Vertical reels:** duplicate the timeline (`right-click > Duplicate Timeline`), `Timeline Settings > uncheck Use Project Settings > 1080 × 1920`, then reposition each clip (`Inspector > Transform`) or use **Smart Reframe** (Studio, `Inspector > Retime and Scaling > Smart Reframe`).
11. **Rendering:** jobs are queued by the tools but never started. Deliver page → check the queue → `Render All`.
12. **Native AI** (Studio): see `NATIVE-AI.md` for where each tool lives.

## Tools the inventory flagged on this PC
- **FFmpeg**: the first `ffmpeg.exe` on your PATH is a broken stub from a Node project (`C:\Projects\reddit2shorts\node_modules\ffmpeg-static`), and `ffprobe` there is a 2018 build. The installer now tests candidates and installs `Gyan.FFmpeg` through winget when none runs; `bjj` and `hypecut` are pinned to the working build (`BJJ_FFMPEG` / `BJJ_FFPROBE`), so you do not need to clean your PATH, though removing that node_modules entry from it is a good idea.
- **Claude Code CLI**: `claude` was not on PATH in the installer's session. The installer also looks in `%USERPROFILE%\.local\bin` and `%APPDATA%\npm`. If it is still not found, install it (`https://code.claude.com/docs/en/setup`) and re-run `install\switch-mcp.ps1 -To gursky` and `install\03-install-skills.ps1 -Overwrite`.

## Claude Code
13. Open a **new** Claude Code session after installing (skills and MCP registrations are read at start). Type `/` and confirm `bjj-analyze … resolve-health` appear; run `/resolve-health`.
14. `claude mcp list` must show `davinci-resolve … Connected` while Resolve Studio is running with step 5 done.
15. To use the `davinci-resolve*` skills (CiprianSpiridon) run `resolve-ai\install\switch-mcp.ps1 -To cipriano` first; switch back with `-To gursky`. Never register two Resolve-control servers at once.

## Commercial plugins
16. Install Colourlab Ai / CrumplePop with their official installers if you decide to buy them (`COMMERCIAL-PLUGINS.md`), then run `06-verify.ps1` and the `davinci-resolve-generate-plugin-list` skill.
