---
name: bjj-cleanup
description: >-
  Identify technical problems in analysed BJJ footage: soft focus, motion blur, shaky camera, under /
  over exposure, blown highlights, variable frame rate, silent clips; propose fixes (Stabilize,
  exclude from reels, exposure match) without deleting or auto-excluding anything. Use for "which
  clips are blurry / shaky", "clean up the footage", "/bjj-cleanup".
argument-hint: "<analysis folder>"
allowed-tools: Bash(bjj *), Bash(bjj.cmd *), Read
---

# /bjj-cleanup — technical QC

1. `bjj issues --analysis <analysis>` -> JSON with per-clip `issues` and `flagged_segments`.
2. Present a table: clip | sharpness (median) | shake p90 px | luma | clipped % | issues.
   Thresholds used: sharpness < 40 soft, shake > 3.5 px shaky, clipped > 3 % blown, luma < 60 dark, > 190 bright.
3. For each problem suggest the Resolve remedy, not an automatic action:
   - shaky -> Inspector > Stabilization (Perspective off for mats), or keep for high-energy only
   - soft -> keep for B-roll / reaction cutaways only; never as the opening shot
   - exposure -> note it for /bjj-color (offset per group)
   - variable frame rate -> transcode to constant frame rate (ffmpeg `-vsync cfr`) before retiming
4. State clearly that nothing was deleted or excluded; the plan templates keep flagged segments
   unless `review.csv` says `keep=no`.
