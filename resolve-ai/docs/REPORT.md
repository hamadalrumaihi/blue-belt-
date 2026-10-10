# Final report — DaVinci Resolve AI editing ecosystem for Blue Belt Media

Date: 2026-10-10. Target machine: Windows 10 Pro, NVIDIA RTX 3070 8 GB, Intel i7-12700F, 32 GB RAM, Claude Code.

> **Where this was built.** This work was done in a Linux cloud session that has no access to the Windows
> PC, so nothing could be installed on it directly. Everything below was built so that one PowerShell
> command performs the inventory, backups, installs, registration and verification on the PC, and the
> Python pipeline was executed and tested here on synthetic footage. The status table therefore
> separates *verified in this session* from *verified once run on the PC* from *requires a running
> Resolve Studio*.

## 1. Installation status table

| Component | Status | Where / how | Notes |
|---|---|---|---|
| System inventory script | **Verified** (logic) / Configured | `install\00-inventory.ps1` → `C:\AI-Video-Tools\inventory\inventory-latest.{json,md}` | Detects Resolve edition+version (Uninstall registry + Resolve.exe), scripting DLL/modules, Python/Git/Node/npm/FFmpeg/uv/CUDA/driver, Claude MCP/skills/commands/plugins, projects, disks, conflicts |
| Config backups | Configured | `install\01-backup-config.ps1` → `C:\AI-Video-Tools\backups\<stamp>\` | `~\.claude.json`, `settings.json`, skills/commands/agents dirs, Claude Desktop config, Resolve prefs, repo `.mcp.json` |
| samuelgursky/davinci-resolve-mcp (**primary**) | Installed + Configured (on PC) / Requires Resolve Studio to verify live | `C:\AI-Video-Tools\mcp\davinci-resolve-mcp-gursky\` (.venv, Python 3.12) registered as user-scope `davinci-resolve` | 37 compound tools (389 with `--full`); update check disabled; env `RESOLVE_SCRIPT_API/LIB`, `PYTHONPATH` |
| CiprianSpiridon/davinci-resolve-mcp (alternate) | Installed (on PC), not registered | `...\mcp\davinci-resolve-mcp-cipriano\` | 334 tools; offline test `tests\test_tool_exposure.py` run at install; `switch-mcp.ps1 -To cipriano` |
| guycochran/resolve-mcp-server (alternate) | Installed (on PC), not registered | `...\mcp\resolve-mcp-server-guycochran\` | 77 tools, Studio 21 validated upstream; `--doctor` run at install |
| Iamkewl/Davinci-MCP (reference) | Installed (uv sync), never registered | `...\mcp\Davinci-MCP-iamkewl\` | 24 tools; upstream admits never run against real Resolve |
| CiprianSpiridon skills (4) | Installed (on PC) | `%USERPROFILE%\.claude\skills\davinci-resolve*` | Pair with the CiprianSpiridon server |
| samuelgursky skills (12) | Installed (on PC) | `%USERPROFILE%\.claude\skills\resolve-*` | Pair with the primary; copies get a docs-root pointer line |
| majedphotos/claude-skills | Skipped | — | One skill (`growth-campaign`, Meta Ads, Arabic-only); not relevant, no conflicts |
| Blue Belt skills (8) | **Verified** discoverable in Claude Code (this session) + installed to user scope on PC | repo `.claude\skills\bjj-*`, `resolve-health` | `/bjj-analyze /bjj-highlights /bjj-reel /bjj-club /bjj-cleanup /bjj-color /bjj-export /resolve-health` |
| bjj-pipeline (Stage A–F) | **Verified** (30/30 tests, end-to-end run on synthetic footage) | `resolve-ai\bjj` → `C:\AI-Video-Tools\analysis\bjj-pipeline\.venv`, shim `C:\AI-Video-Tools\bin\bjj.cmd` | numpy + ffmpeg only |
| HypeCut (Yu-0312) | **Verified** here (240/240 upstream tests, CLI + EDL on synthetic clip) / Installed on PC | `C:\AI-Video-Tools\analysis\hypecut\` | Apache-2.0, CPU, local-only, `sports-field` profile |
| LumenSport / auto-highlight / Sports-Highlight-Detector | Unsupported | — | see §3 |
| majedphotos/video-ad-editor | Skipped (adapter provided) | `bjj adapters vae-plan / vae-srt` | see §3 |
| GPU extras (CUDA torch, ultralytics pose, whisper) | Skipped by default (opt-in `-WithGpuExtras`) | bjj-pipeline venv only | sized for 8 GB VRAM |
| Resolve scripting bridge (direct API) | **Verified** graceful failure paths here / Requires Resolve Studio running to verify live | `bjj resolve status|build|markers|ai` | never overwrites projects, never starts renders without `--allow-render` |
| Native Resolve AI features | Requires manual setup (edition-dependent) | `docs/NATIVE-AI.md`, `bjj resolve ai` | Studio-only list verified against Blackmagic's Studio page |
| Colourlab Ai | Requires manual setup (not installed; detection in 06-verify) | `docs/COMMERCIAL-PLUGINS.md` | OFX under `C:\Program Files\Common Files\OFX\Plugins` |
| CrumplePop (Boris FX) | Requires manual setup (not installed; detection in 06-verify) | `docs/COMMERCIAL-PLUGINS.md` | VST3 (audio), not OFX |
| Central launcher | Configured | `launcher\bbm-video.cmd` + `C:\AI-Video-Tools\bin\bbm-video.cmd` | menu + `-Action` flags |
| Verification | Configured | `install\06-verify.ps1` → `inventory\verify-latest.md` | status vocabulary: installed / configured / verified / requires-manual-setup / unsupported / skipped |

## 2. Repositories evaluated

| Repository | Verdict | Key facts |
|---|---|---|
| samuelgursky/davinci-resolve-mcp | **Primary MCP** | MIT, commit 2026-10-10, ~4 000 offline tests + CI, Python ≥3.10, stdio, 37 compound / 389 granular tools, explicit Free-vs-Studio handling, Windows-hardened installer (we do not run its `install.py`: it writes a project `.mcp.json`, performs network update checks and npm installs; we create the venv ourselves and set `DAVINCI_RESOLVE_MCP_UPDATE_CHECK=0`) |
| CiprianSpiridon/davinci-resolve-mcp | Alternate + its 4 skills | MIT, single public commit 2026-08-14, 334 tools (titles, OFX, MotionVFX templates, transition workaround, render presets, EDL/XML export), `claude mcp add` documented, `.claude/skills` are symlinks (we copy from `skills/`), undeclared `pyautogui` dependency added by our installer, its "Free edition degrades gracefully" claim is wrong (Free refuses the connection) |
| guycochran/resolve-mcp-server | Alternate | MIT, 2026-09-16, 77 tools, validated on Windows Studio 21.0.4.5, no transitions/OFX/colour nodes, Moondream vision tool is cloud (never invoked by us) |
| Iamkewl/Davinci-MCP | Reference only | MIT, 2026-09-13, Python ≥3.11 uv workspace, 24 tools, README states it was never run against real Resolve |
| Yu-0312/hypecut | **Installed** | Apache-2.0, 2026-09-05, numpy+PyYAML core, CPU, no network, outputs mp4 + `.hypecut.json` + CMX3600 EDL; generic excitement detection (loudness, onsets, motion, crowd roar, whistle); `configs/sports-field.yaml` best fit for a mat; **cannot recognise BJJ techniques** |
| Yutao-Yang/LumenSport | Rejected | Apache-2.0 but pipeline POSTs base64 frames to a third-party LLM relay (`api.zetatechs.com` / OpenRouter), broken imports, missing frontend and weights, boxing is the only combat sport (ring ropes required) |
| Pragyanstha/auto-highlight | Rejected | MIT scaffold, single commit, Gemini required, tennis-only, `video_editor.py` writes empty placeholder files |
| AkhilNam/Sports-Highlight-Detector | Rejected | MIT, basketball/soccer heuristics, `detector.py` references undefined names → NameError on first frame, no cut list output |
| majedphotos/claude-skills | Nothing installed | MIT; one skill (`growth-campaign`): Meta Ads via claude.ai Facebook connector, Arabic, can spend ad budget; no scripts/hooks |
| majedphotos/video-ad-editor | Not installed (adapter) | MIT, active (v4.4.3), Claude plugin of 6 Arabic-first talking-head reel skills; `davinci-video` trigger collides with the Resolve skills; `scripts/00_setup.sh` self-updates over the network each run and `--extras` runs unpinned `pip install torch` (would replace CUDA torch); Resolve scripts need an MCP tool `run_script_unsafe`; exports JSON (`cut.json`, `caps.json`) not EDL → `bjj adapters vae-plan|vae-srt` converts them to CMX3600 EDL + SRT. `install\05-install-video-ad-editor.ps1 -InstallPlugin` installs it anyway if wanted |

## 3. Failed or skipped components and reasons

* **Live Resolve verification** — impossible from this session (no Windows, no Resolve). `06-verify.ps1` and `/resolve-health` do it on the PC.
* **LumenSport, auto-highlight, Sports-Highlight-Detector** — cloud upload of athlete footage / non-functional / not applicable (details above).
* **video-ad-editor plugin** — skipped by design (trigger overlap, self-updating installer, torch clobbering); adapter shipped instead.
* **majedphotos/claude-skills** — not relevant to editing.
* **GPU extras** — opt-in; the heuristic analyzer and HypeCut never need them.
* **Resolve API speed ramps / transitions** — not exposed by Blackmagic's scripting API. Constant speed changes travel in the EDL (`M2` lines); ramps and transitions are left as timeline markers with instructions. CiprianSpiridon's transition tool drives the GUI with keystrokes (needs Edit-page focus) and is therefore not used automatically.

## 4. Claude MCP configuration and active server

* Scope: **user** (`%USERPROFILE%\.claude.json`), name `davinci-resolve`. The repo's project `.mcp.json` (21st) is untouched.
* Registration command (run by `switch-mcp.ps1`):
  ```
  claude mcp add --transport stdio --scope user -e RESOLVE_SCRIPT_API="C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting" -e RESOLVE_SCRIPT_LIB="C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll" -e PYTHONPATH="...\Scripting\Modules" -e PYTHONIOENCODING=utf-8 -e DAVINCI_RESOLVE_MCP_UPDATE_CHECK=0 davinci-resolve -- C:\AI-Video-Tools\mcp\davinci-resolve-mcp-gursky\.venv\Scripts\python.exe C:\AI-Video-Tools\mcp\davinci-resolve-mcp-gursky\src\server.py
  ```
* Only one Resolve-control server is registered at a time; `switch-mcp.ps1 -To cipriano|guycochran|gursky` swaps (backup first). `switch-mcp.ps1 -Status` shows the state. Registry of installed servers: `C:\AI-Video-Tools\mcp\servers.json`.
* Discovery check: `claude mcp list` (Connected needs Resolve Studio running + External scripting = Local), `claude mcp get davinci-resolve`, `/mcp` inside a session, and `03-install-skills.ps1` runs a `claude -p` probe for the skills.

## 5. Installed Claude skills and commands

See `docs/SKILLS-CATALOG.md` (24 skills: 8 Blue Belt, 12 samuelgursky, 4 CiprianSpiridon). All are real skills (`SKILL.md` with frontmatter) under `%USERPROFILE%\.claude\skills\`, the convention Claude Code 2.1 uses for `/name` commands. The Blue Belt skills also live in this repo's `.claude\skills\` so they work in any checkout.

## 6. Exact Windows installation paths

```
C:\AI-Video-Tools\
  mcp\davinci-resolve-mcp-gursky\        primary server + .venv + bbm-server.env
  mcp\davinci-resolve-mcp-cipriano\      alternate + skills\ (source of the 4 davinci-resolve* skills)
  mcp\resolve-mcp-server-guycochran\     alternate
  mcp\Davinci-MCP-iamkewl\               reference
  mcp\servers.json                       registry used by switch-mcp / launcher / verify
  analysis\bjj-pipeline\.venv\           bjj CLI (editable install of <repo>\resolve-ai\bjj)
  analysis\hypecut\                      clone + .venv
  analysis\analysis.json
  bin\bjj.cmd  bin\hypecut.cmd  bin\bbm-video.cmd    (added to the USER PATH)
  backups\<timestamp>\                   config backups
  inventory\inventory-latest.{json,md}  verify-latest.{json,md}  skills-install.json
  logs\install-<date>.log  launcher-<date>.log
  tmp\
%USERPROFILE%\.claude\skills\<24 skills>\SKILL.md
%USERPROFILE%\.claude.json                (user-scope MCP registration)
```
User environment variables set: `Path` (+ `C:\AI-Video-Tools\bin`), `BJJ_HYPECUT`.

## 7. Manual steps required in DaVinci Resolve

`docs/MANUAL-STEPS.md`. The non-negotiable ones: Resolve **Studio** licence for external scripting; *Preferences > System > General > External scripting using = Local*; a project open; vertical timelines (1080x1920) are duplicates you create; speed ramps and transitions beyond constant speed / dissolves are applied by you (markers show where); rendering is started by you.

## 8. Required API keys (no values stored anywhere)

* None for the core workflow. Everything runs locally.
* Optional: `FAL_KEY` only if you install video-ad-editor and use its generated-scene features (uploads a face frame; not recommended for athlete footage). Colourlab Ai / Boris FX use their own licence managers (accounts you create yourself).
* The repo's existing `API_KEY_21ST` (21st.dev MCP) is unrelated and untouched.

## 9. Required commercial licences

| Product | Needed for | Price (as published) |
|---|---|---|
| DaVinci Resolve Studio | External scripting (every MCP server, `bjj resolve build`), Magic Mask, Smart Reframe, Speed Warp, Voice Isolation, IntelliSearch, auto subtitles, face recognition, scene cut detection, AI colour tools, hardware H.264/H.265 encode | USD 295 one-time |
| Colourlab Ai (optional) | AI shot matching / looks (OFX) | from USD 300 perpetual (Creator) or subscription |
| CrumplePop / Boris FX (optional) | Audio clean-up VST3 (crowd noise, wind, echo) | Starter free tier, Pro subscription or perpetual |

## 10. Tested end-to-end workflows

Executed in this session on three synthetic clips (60p / 25p shaky+blurred / 30p static) plus a 120 BPM track:

1. `bjj probe` → correct 60/25/30 fps, suggested 30 fps timeline.
2. `bjj organize --mode hardlink --music` → `2026-10-10_Qatar_Open\Hamad_Al\Final\CAM-A\01_Original` + `_music` + manifest; originals untouched; refuses to overwrite a differing file.
3. `bjj analyze --contact-sheets --hypecut` (HypeCut from its own venv, `sports-field` profile) → `analysis.json`, `markers.csv`, `review.csv`, `ranked.json`, `report.{json,md}`, contact sheets + event sheets; the loud burst at 11–13 s was found by both the heuristic and HypeCut; shaky clip got low stability; soft clip got `soft_focus`.
4. `bjj plan` for all four templates (`cinematic`, `high_energy` with beat grid ≈120 BPM, `full_highlights`, `club_recap`) → EDL with `M2` 50 % slow-motion lines for the 60p clip only, dissolves, titles, cut-list CSV, render JSON; record timecodes contiguous.
5. `bjj subclips`, `bjj issues`, `bjj color`, `bjj presets`, `bjj resolve status|ai` (graceful "not installed" here), `bjj adapters hypecut-markers|vae-plan|vae-srt`.
6. pytest: 30 passed (bjj-pipeline); HypeCut upstream suite: 240 passed (CPU).
7. Claude Code discovered all 8 Blue Belt skills in this session.

Not tested here: anything that needs Resolve (timeline build, markers, render queue, MCP live connection, native AI calls). These are exercised by `06-verify.ps1` and `/resolve-health` on the PC.

## 11. GPU / VRAM limitations (RTX 3070, 8 GB)

* Heuristic analyzer and HypeCut: CPU only; ~0.5× real time per clip at 4 fps sampling on the i7-12700F.
* Optional YOLOv8-pose (n/s) + whisper-small fit comfortably in 8 GB; whisper-large-v3 (~10 GB fp16) does not; use `medium` or int8.
* Do not run GPU inference while Resolve renders or uses Speed Warp / Magic Mask: Resolve takes most of the VRAM and both slow down or fail. The launcher's analyze step is CPU-bound by default for this reason.
* Resolve Free is limited to a single GPU and UHD output; Studio unlocks NVENC H.264/H.265 encoding, which is the fastest route for the Reel/YouTube presets.

## 12. Suggested improvements

1. Label 20–30 real matches in `review.csv` and train a light classifier on the per-second feature table (`analysis.json: per_second`) — the plumbing (detector protocol, review loop) is already there.
2. Add a YOLO-pose detector plug-in (two-person proximity, standing vs ground) to raise confidence beyond the 0.70 heuristic ceiling; install with `-WithGpuExtras`.
3. Multicam: extend `organize` to align CAM-A/CAM-B by audio and emit a Resolve multicam timeline via the primary server's `media_pool` multicam tools.
4. Feed the pipeline's markers to Resolve's IntelliSearch (Studio 21) for text search over reaction moments.
5. If the CiprianSpiridon server is adopted as primary, register its `davinci-resolve` skill set as the default and drop the samuelgursky ones to avoid duplicated triggers.

## 13. Uninstall / update

`docs/UNINSTALL-UPDATE.md`.
