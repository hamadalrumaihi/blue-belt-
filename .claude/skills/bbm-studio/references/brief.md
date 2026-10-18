# Brief (brief.json)

Annotated example — strip the `//` comments before saving (JSON has no comments).

```json
{
  "kind": "athlete_highlight",          // athlete_highlight | team_recap | tournament_reel | promo | fight_edit
  "title": "Qatar Open 2026 - Ahmed",
  "athletes": ["Ahmed"],                // as H writes them; only used in captions/notes, never "detected"
  "target_seconds": 30,
  "format": "vertical",                 // vertical 1080x1920 (default) | landscape 1920x1080 | square 1080x1080
  "fps": null,                          // null = from footage (50/60 fps sources -> 25/30 timeline, real slow-mo)
  "captions": [
    {"text": "بطولة قطر المفتوحة ٢٠٢٦", "lang": "ar", "role": "title"},
    {"text": "Ahmed · Blue Belt", "lang": "en", "role": "lower_third", "start": 3.0, "end": 5.5},
    {"text": "@bluebeltmedia.qa", "lang": "en", "role": "cta"}
  ],
  "music": null,                        // local file H has rights to; null = natural sound only
  "music_gain_db": -18,
  "natural_sound": true,
  "allow_slowmo": true,
  "allow_stabilize": true,
  "keep_chronology": false,             // true = source order (fight_edit forces it)
  "notes": "first tournament for this athlete; parents will share it",
  "mode": "footage"                     // "animation" is an optional ReelMimic route, not implemented locally
}
```

Caption roles: `title` (big, first ~2 s), `lower_third`, `caption`, `cta` (anchored to the end, follows
the edit when it gets shorter). Positions: `top` / `center` / `bottom`, always inside the Reels safe
area. `start`/`end` optional; without them the planner places titles at the start and CTAs at the end.

Defaults by kind (brief-only mode, no reference):

| kind | shot length | hook | transitions | slow-mo | order |
|---|---|---|---|---|---|
| athlete_highlight | 1.8 s | 2.4 s | cuts | yes (>= 50 fps) | strongest moment first |
| team_recap | 2.2 s | 2.8 s | short dissolves | no | interleaved sources |
| tournament_reel | 1.4 s | 2.0 s | cuts | yes | strongest first |
| promo | 1.2 s | 1.6 s | cuts | yes | strongest first |
| fight_edit | up to 10 s (whole exchanges) | 4 s | cuts | no | chronological |

With a reference, its median shot length / hook length / look replace these (clamped to what reads
for grappling: 0.7-4 s, fight edits up to 12 s).
