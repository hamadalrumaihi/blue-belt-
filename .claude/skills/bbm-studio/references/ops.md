# Revision operations (bjj studio revise --ops ops.json)

An ops file is a JSON list. Every op should carry `why` (problem + timestamp): it is copied into
`revisions.jsonl`. Clip ids (`c01`...) are stable across versions; caption ids are `t1`...

| op | fields | effect |
|---|---|---|
| `trim` | `clip`, `in_delta`, `out_delta` (s, source time; + = later) | move in/out points |
| `replace` | `clip`, optional `candidate` id | swap in the next-best unused moment of the same kind (or that candidate); reframe recomputed |
| `remove` | `clip` | drop the clip |
| `move` | `clip`, `to` (1-based) | reorder |
| `reframe` | `clip`, `mode` (`crop` / `fit_blur` / `fit_pad` / `none`), optional `x` (crop centre 0..1) | change vertical/square framing |
| `speed` | `clip`, `speed` (0.25-1 slow, >1 fast), `keep_duration` (default true) | real-frame slow motion only when source fps / timeline fps >= 1/speed (validation warns otherwise) |
| `audio` | `clip`, `gain_db`, `fade_in`, `fade_out` | natural-sound level / fades |
| `transition` | `clip`, `type` (`cut` / `dissolve` / `dip_to_black`), `duration` | transition INTO this clip |
| `color` | `clip`, `gamma`, `contrast`, `saturation` | exposure/contrast; keep saturation 0.95-1.05 for skin |
| `stabilize` | `clip`, `on` | vid.stab two-pass (crops ~8 %) |
| `caption` | `caption` + any of `text`, `start`, `end`, `position` (top/center/bottom), `lang`, `role` | edit |
| `caption` | `add: {text, lang, start, end, role, position}` / `remove: "t2"` | add / delete |
| `music` | `gain_db`, `duck_db`, `path` | music bed |

## Examples

Feedback "the sweep at 0:07 is cut before he comes up" (layout shows c04 = 6.1-7.4 s):
```json
[{"op": "trim", "clip": "c04", "out_delta": 0.8, "why": "feedback fb123: sweep cut before it resolves at 7.4s"}]
```

Reviewer: "c06 and c09 are the same exchange from two phones (index overlap high)":
```json
[{"op": "replace", "clip": "c09", "why": "review: c09 repeats c06's exchange from CAM-B (6.2s / 11.0s)"}]
```

Arabic title typo + CTA later:
```json
[{"op": "caption", "caption": "t1", "text": "بطولة الدوحة للجوجيتسو", "why": "H corrected the title"},
 {"op": "caption", "caption": "t2", "start": 26.5, "end": 29.4, "why": "CTA should hold on the closing photo"}]
```

Crowd roar under the music at 0:18 (c08):
```json
[{"op": "audio", "clip": "c08", "gain_db": 3, "why": "reaction buried at 18.2s"},
 {"op": "music", "duck_db": 9, "why": "music masks reactions"}]
```

Not an op: changing the brief (type, length, format, athletes). Edit the brief and `bjj studio resume`
— that re-plans from scratch (a new timeline version; earlier versions stay on disk).
