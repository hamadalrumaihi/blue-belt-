# The BJJ tournament workflow (Stages A–F)

```
card / phone footage ─A─> Library/<date>_<tournament>/<athlete>/<match>/<camera>/01_Original
                      ─B─> _analysis/run-N/{analysis.json, markers.csv, review.csv, report.md, contact-sheets}
   editor fills review.csv (label / keep / narrative_1to5)
                      ─C─> ranked.json (scores 0-100, review flags, nothing discarded)
                      ─D─> plans/<name>.{plan.json, edl, cuts.csv, render.json}   (4 templates)
                      ─E─> Resolve project (new) + timeline (EDL import, markers, Text+ title)  [Studio]
                      ─F─> render queue: instagram_reel / instagram_story / youtube / master (not started)
```

## Stage A — import and organisation
`bjj organize <src> --library <L> --tournament "<T>" --date YYYY-MM-DD --athlete "<A>" --match "<M>" --camera CAM-A [--music <dir>] [--mode copy|hardlink] [--checksum]`
Originals keep their names; `02_Selected` receives `bjj subclips` output; `03_Exports` is for renders. A JSON manifest per import records source, destination, size, optional SHA-256 and probed media properties.

## Stage B — analysis (local)
Per clip: greyscale frames at 4 fps / 256 px → motion, camera shift (phase correlation), Laplacian sharpness, luma, clipping, centre edge ratio, histogram delta; audio RMS per 250 ms. Candidate events:

| kind | signal | suggested labels (review vocabulary) |
|---|---|---|
| `action_peak` | motion (absolute scale) + audio lift ≥ 0.55 for ≥ 2 s | intense_exchange, scramble, takedown, sweep, guard_pass, submission |
| `celebration_candidate` | audio ≥ +8 dB over clip median within 6 s after an action peak | celebration, crowd_reaction, coach_reaction, referee_call |
| `crowd_reaction` | audio spike elsewhere | crowd_reaction, coach_reaction, referee_call, walkout |
| `low_activity` | action ≤ 0.12 for ≥ 8 s | walkout, stalling, podium, warmup, b_roll |
| `scene_cut` | histogram delta ≥ 0.45 | (in-camera cut) |
| `detector:hypecut` | HypeCut segments (crowd roar, loudness, onsets, motion, whistle) | mapped from its top reasons |

Confidence is capped at 0.70 for all heuristics. **No model here recognises BJJ techniques.** The
human review step is where labels become facts. Optional detector plug-ins (`analyze.Detector`
protocol) can add pose/person signals later without changing the rest.

## Stage C — ranking
Nine sub-scores (focus, motion blur, stability, composition, subject visibility, action intensity, lighting, narrative importance, usability) weighted by `config/scoring.json`. Flags (`soft_focus`, `shaky`, `under_or_over_exposed`, `subject_unclear`) are review markers. Action intensity is never a discard criterion.

## Stage D — edit plans
| template | length | character |
|---|---|---|
| `cinematic` | 15–30 s | B-roll/reaction opener with title, ≤ 4 s cuts, 50 % slow motion when the source has the frames, cross dissolves, reaction closer |
| `high_energy` | 15–45 s | ≤ 1.6 s cuts snapped to the music's beat grid (autocorrelation tempo), hard cuts, no slow motion |
| `full_highlights` | 60–120 s | chronological by clip/time, ≤ 8 s cuts, reactions after strong actions, strong ending |
| `club_recap` | 45–90 s | round-robin across `--athletes`, dissolves, title, podium/celebration closer |

Slow motion is only proposed from real frames (`max_clean_slowmo_factor`), never slower than 25 %.

## Stage E — Resolve
`bjj resolve build --plan <plan.json> --project "<new name>"`: creates the project (unique name), sets the timeline frame rate from the plan, imports media into a `BJJ_Pipeline` bin, imports the EDL as a timeline (fallback: `AppendToTimeline` + markers), adds role markers and Text+ titles, queues the plan's render presets. Or let the active MCP server do the same from the skills.

## Stage F — render presets
`bjj presets --timeline-fps <rate>`: `instagram_reel` 1080×1920 H.264 14 Mb/s, `instagram_story` 1080×1920 12 Mb/s, `youtube` 1920×1080 H.264 20 Mb/s, `master` DNxHR HQX MOV + PCM. Frame rate always copied from the timeline; vertical presets require a vertical timeline or Smart Reframe (Studio).
