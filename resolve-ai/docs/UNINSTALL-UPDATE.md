# Uninstall / update each component

Everything is user-scoped: no services, no registry writes, no admin. Backups of every config touched are in `C:\AI-Video-Tools\backups\<timestamp>\` (restore = copy back).

| Component | Update | Uninstall |
|---|---|---|
| MCP servers (gursky / cipriano / guycochran / iamkewl) | re-run `install\02-install-mcp.ps1` (git `pull --ff-only`, venv reused, deps re-synced) | `claude mcp remove davinci-resolve --scope user`, then delete `C:\AI-Video-Tools\mcp\<dir>` |
| Active server choice | `install\switch-mcp.ps1 -To <name>` | `claude mcp remove davinci-resolve --scope user` |
| Upstream skills (resolve-*, davinci-resolve*) | re-run `02-install-mcp.ps1` then `03-install-skills.ps1 -Overwrite` | delete the folders under `%USERPROFILE%\.claude\skills\` |
| Blue Belt skills (bjj-*, resolve-health) | `git pull` in the repo, then `03-install-skills.ps1 -Overwrite` | delete the folders under `%USERPROFILE%\.claude\skills\` |
| bjj-pipeline | `git pull`, then `04-install-analysis.ps1` (editable install picks up code changes immediately) | delete `C:\AI-Video-Tools\analysis\bjj-pipeline`, `bin\bjj.cmd` |
| HypeCut | `04-install-analysis.ps1` (git pull + pip) | delete `C:\AI-Video-Tools\analysis\hypecut`, `bin\hypecut.cmd`, user env var `BJJ_HYPECUT` |
| GPU extras | `04-install-analysis.ps1 -WithGpuExtras` | `uv pip uninstall --python C:\AI-Video-Tools\analysis\bjj-pipeline\.venv\Scripts\python.exe torch torchvision ultralytics openai-whisper` |
| Launcher | nothing to update (reads the repo) | delete `C:\AI-Video-Tools\bin\bbm-video.cmd` |
| User PATH entry | — | remove `C:\AI-Video-Tools\bin` from *User* `Path` (System Properties > Environment Variables) |
| Everything | `install-all.ps1` is idempotent | `claude mcp remove davinci-resolve --scope user`; delete the 24 skill folders; delete `C:\AI-Video-Tools`; remove the PATH entry and `BJJ_HYPECUT` |

Nothing in `C:\Program Files`, nothing in Resolve's own folders (the in-app bridge script of the samuelgursky project is **not** installed by us), no scheduled tasks, no open ports.
