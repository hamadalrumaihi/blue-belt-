# Claude skills catalog

All skills are directories with a `SKILL.md` (Claude Code 2.1 convention). Project copies live in
`<repo>\.claude\skills\`; `install\03-install-skills.ps1` copies everything below to
`%USERPROFILE%\.claude\skills\` so they work from any folder. None declares hooks; the installer refuses
any skill that does.

## Blue Belt Media (this repo) — server-agnostic

| skill | when to use | what it runs |
|---|---|---|
| `/bjj-analyze <footage> [--out]` | first pass on a card or folder: probe, (optional organize), analyze, report | `bjj probe`, `bjj organize`, `bjj analyze --contact-sheets --hypecut` |
| `/bjj-highlights <analysis>` | rank candidates, honour `review.csv`, build a `full_highlights` (or other) plan with EDL | `bjj rank`, `bjj plan` |
| `/bjj-reel <analysis> --athlete X` | 15–30 s cinematic vertical reel for one athlete; builds timeline via MCP → bridge → manual EDL | `bjj plan --template cinematic`, `bjj resolve build` |
| `/bjj-club <analysis> --athletes A,B,C` | 45–90 s balanced club recap | `bjj plan --template club_recap` |
| `/bjj-cleanup <analysis>` | technical QC: blur, shake, exposure, VFR; remedies, no auto-exclusion | `bjj issues` |
| `/bjj-color <analysis>` | colour groups, exposure offsets, Color-page steps, edition-aware AI tools | `bjj color`, `bjj resolve ai` |
| `/bjj-export` | the four render presets from the real frame rate; queue, never start | `bjj presets`, `bjj resolve build --presets` |
| `/resolve-health [--plugins]` | connectivity, active MCP server, bridge, skills, tools, native AI, plugins, fixes | `claude mcp list/get`, `bjj doctor`, `bjj resolve status/ai`, `06-verify.ps1` |

## samuelgursky/davinci-resolve-mcp — pair with the PRIMARY server (`switch-mcp.ps1 -To gursky`)

Copied from the clone's `.claude/skills/`; a pointer line to `C:\AI-Video-Tools\mcp\davinci-resolve-mcp-gursky\` is inserted because the text references repo-relative `docs/` files.

| skill | use when |
|---|---|
| `resolve-mcp` | orientation / map of the domain skills, live-vs-offline servers, safety rules |
| `resolve-session` (user-invoked only) | start a session: connect, confirm edition, open project, report state |
| `resolve-edit` | cutting, trimming, restructuring, variants, changelists |
| `resolve-rough-cut` | assemble a short-form rough cut from a folder of footage (vertical setup, gapless assembly) |
| `resolve-tighten-recording` | remove dead air from one long take |
| `resolve-media-pool` | ingest, bins, multicam, relink, clip marks |
| `resolve-media-analysis` | read-only ffprobe/ffmpeg/whisper analysis of sources |
| `resolve-color` | grading, shot match, LUT/CDL/DRX |
| `resolve-fusion` | Fusion comps, titles, motion graphics |
| `resolve-audio` | Fairlight, voice isolation, subtitles, loudness |
| `resolve-conform` | conform/relink/QC |
| `resolve-delivery` | render jobs, deliverable QC, manifests |

Skipped: `house-style` (project-specific taste notes, auto-loaded, not user-invocable) and `release-check` (maintainer workflow).

## CiprianSpiridon/davinci-resolve-mcp — pair with the ALTERNATE server (`switch-mcp.ps1 -To cipriano`)

Copied from the clone's `skills/` (the `.claude/skills` entries upstream are symlinks). Requirements per upstream: Resolve Studio 19+, ffmpeg on PATH (silence skill), the server venv's python (plugin-list skill).

| skill | use when | notes |
|---|---|---|
| `davinci-resolve` | drive Resolve through that server's 334 tools; cookbook + tool catalog in `reference/` | |
| `davinci-resolve-use-plugins` | apply ResolveFX/OFX, drop MotionVFX titles/transitions by MediaIn count | Studio |
| `davinci-resolve-generate-plugin-list` | index installed plugins/templates to `davinci-plugins.{json,md}` | **writes a summary block into the current project's root `CLAUDE.md`**; run it from a scratch folder or accept the block. Re-run after installing Colourlab / CrumplePop |
| `davinci-resolve-remove-silences-bad-takes-and-umms` | tighten talking-head material: ffmpeg silence detection + Studio transcription + Haiku subagent | scripts are plain Python (`detect_silence.py`, `plan_cuts.py`, `build_and_verify.py` executed inside Resolve via the server) |

## Evaluated, not installed

* `majedphotos/claude-skills` → `growth-campaign` (Meta Ads via claude.ai connector, Arabic). Not an editing skill; could spend ad budget.
* `majedphotos/video-ad-editor` plugin (`majed-video`: video-ad-editor, davinci-video, montage-video, motion-video, podcast-video, thumbnail-video). Trigger overlap with the Resolve skills, self-updating setup script, Mac-only features. Adapter: `bjj adapters vae-plan|vae-srt`.
