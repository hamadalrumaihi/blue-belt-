# bjj-pipeline

> **New: BBM Studio** (`bjj studio ...`) renders finished edits end to end — ingest, footage
> understanding, optional reference breakdown, timeline plan, FFmpeg draft, measured QC, timestamped
> revisions, final export with OTIO/FCPXML/EDL. See [../docs/STUDIO.md](../docs/STUDIO.md) and
> [../docs/STUDIO-STATUS.md](../docs/STUDIO-STATUS.md). Windows: `..\launcher\bbm-studio.cmd`.

Local, offline footage pipeline for Blue Belt Media's Brazilian jiu-jitsu tournament work.
It organises camera cards, measures every clip, proposes candidate moments for a human to
confirm, ranks them, builds four kinds of edit plans, exports CMX3600 EDLs / CSV cut lists /
JSON reports / contact sheets, and (when DaVinci Resolve Studio is running) builds editable
timelines and queues render jobs through Blackmagic's official scripting API.

```
bjj doctor                                            # tools + Resolve connectivity
bjj organize D:\CARD\DCIM --library E:\BJJ --tournament "Qatar Open" --date 2026-10-10 --athlete "Hamad" --match Final --camera CAM-A
bjj analyze "E:\BJJ\2026-10-10_Qatar_Open\Hamad" --out "E:\BJJ\2026-10-10_Qatar_Open\_analysis\run1" --contact-sheets --hypecut
#   -> report.md, review.csv (fill label / keep / narrative_1to5), markers.csv, contact sheets
bjj plan --analysis ...\run1 --template cinematic --name "Hamad Final Reel" --review ...\run1\review.csv
#   -> Hamad_Final_Reel.edl / .cuts.csv / .plan.json / .render.json
bjj resolve build --plan ...\plans\Hamad_Final_Reel.plan.json --project "BJJ 2026-10-10 Qatar Open"
#   never overwrites a project; queues render jobs but never starts rendering without --allow-render
```

Honesty notes

* Event kinds are heuristic candidates from motion, camera-shake, sharpness, exposure and
  audio signals (plus HypeCut's excitement scoring when installed). The pipeline does **not**
  recognise takedowns, sweeps or submissions; `suggested_labels` is the review vocabulary.
  Heuristic confidence is capped at 0.70.
* Frame rates are probed, never assumed. Slow motion is proposed only when the source has
  enough real frames (60 fps on a 30 fps timeline = 50 %). Otherwise the plan tells you to
  use Optical Flow (Free) or Speed Warp (Studio).
* Nothing is discarded automatically; low technical scores only add review flags.
* Originals are copied or hard-linked, never moved or deleted.

Tests: `pytest` (needs ffmpeg; all footage is synthetic).
