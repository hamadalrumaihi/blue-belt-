# Native DaVinci Resolve AI features and where they fit the BJJ workflow

Edition facts come from Blackmagic's Resolve Studio comparison page and the 21.0.2 readme (checked 2026-10-10);
`bjj resolve ai` reports the same table against the edition actually detected on your PC.

| Feature | Free | Studio | Script/MCP access | Use in this workflow |
|---|---|---|---|---|
| IntelliSearch (21+) | — | ✔ | `MediaPoolItem.AnalyzeForIntelliSearch` (primary server: `media_analysis`) | text search over analysed media ("celebration", "podium"); run after `bjj analyze` markers are placed |
| Magic Mask | — | ✔ | `TimelineItem.CreateMagicMask` (both servers) | isolate the athlete for a selective grade or vignette on the reel opener; manual check required |
| Smart Reframe | — | ✔ | `TimelineItem.SmartReframe` | 16:9 → 9:16 reels; verify every cut, mats fool the subject tracker |
| Speed Warp | — | ✔ | RetimeProcess property (`set_retime_and_scaling` / `timeline_item set_retime`); speed itself is GUI | slow motion when the source lacks real frames (24/25/30 fps) |
| Optical Flow | ✔ | ✔ | same property | Free-edition fallback for the above |
| Voice Isolation | — | ✔ | Fairlight track property (`audio` tools) | coach/corner audio under crowd noise; alternative: CrumplePop |
| Automatic subtitles / transcription | — | ✔ | `Timeline.CreateSubtitlesFromAudio` | interviews, commentary; not for match footage |
| Facial recognition (people bins) | — | ✔ | GUI only (Media page) | sort a tournament card by athlete before `bjj organize --athlete` |
| Scene cut detection | — | ✔ | `Timeline.DetectSceneCuts` | split long continuous recordings; `bjj analyze` also emits `scene_cut` events |
| AI colour tools (AI UltraNR, Face Refinement, Depth Map, Relight, SuperScale) | — | ✔ | GUI (ResolveFX) / `apply_ofx_to_clip` on the CiprianSpiridon server | noisy gym footage (UltraNR), podium portraits (Face Refinement); `/bjj-color` lists them when Studio is detected |
| Stabilization | ✔ | ✔ | `TimelineItem.Stabilize` | shaky handheld clips flagged by `/bjj-cleanup` |
| Hardware H.264/H.265 encode | — | ✔ | render settings | fastest Reel/YouTube exports |

Rules applied by the skills: an AI feature is only suggested when `bjj resolve ai` says it is available for the detected edition; nothing is applied automatically to a whole timeline; every AI result is a review item, not a final.
