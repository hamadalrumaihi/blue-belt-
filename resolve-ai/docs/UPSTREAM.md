# Upstream projects: what was inspected, reused, and how to update

Inspected 2026-10-18 (full clones, source + READMEs + agent instructions + licences + tests + open issues).

| project | commit inspected | licence (from the LICENSE file) |
|---|---|---|
| [edenfunf/reelmimic](https://github.com/edenfunf/reelmimic) | `782a3ba3cfa455663127348dbfcbcfafada05d52` (2026-10-16) | MIT (app, video-clone skill); Apache-2.0 for HyperFrames-derived skills (`LICENSES/Apache-2.0.txt`, `THIRD_PARTY_NOTICES.md`) |
| [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | `652b2692f8d8ec2b1f1a38e559073e287dfdc469` (2026-10-15) | MIT |
| [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | `c8066452325cb57c8fc1ba8c2a71b6e8842e6b65` (2026-10-16) | AGPL-3.0 |
| hamadalrumaihi/blue-belt- (this repo) | branch base `f9ca1d0d45dd4e58ad9ec10e6a225575e0fea80d` | MIT (resolve-ai/bjj) |

## What each project actually implements

**ReelMimic** — a local Node 22 + React app (`app/server/*.ts`) that schedules Claude Code / Codex
CLI turns and checks the files they write. Real code: the stage machine, review-and-fix loop
(`review.ts`), JSON contract checks, and a Python reference analyzer
(`.claude/skills/video-clone/scripts/analyze.py`: PySceneDetect shots, optical-flow camera moves,
look stats, librosa beats/peaks, contact sheets). Prompt-only: all creative work (style, storyboard,
building shots, critique). Hard-limited to 2D animation ("no live-action or real people" in its
CLAUDE.md/prompts). Open issues relevant here: #12 cancel does not stop builders, #13 non-ASCII
upload names crash, #37 second instance dies on the port.

**agency-agents** — ~200 Markdown persona files plus converters/installers for different tools.
No execution engine, no video pipeline, no sports-editing role.

**OpenMontage** — 138 Python tool wrappers (`tools/`) a coding agent is told to call by reading
Markdown (`AGENT_GUIDE.md`: "No orchestration logic ... in Python code"). Local FFmpeg wrappers exist
for scene detect, face-tracked reframe, colour grade, ducking/loudnorm mixing, trims/crossfades,
subtitles (SRT/VTT, no ASS, no RTL), Remotion rendering; most generative tools are paid APIs. No
stabilisation, no blackdetect/freezedetect QC, no NLE timeline export. Open issues include #734
(colour_grade intensity inverted / LUT fallback) and #722 (test network guard bypass).

## Overlap and decisions
| capability | ReelMimic | OpenMontage | bjj-pipeline (before) | BBM Studio (now) |
|---|---|---|---|---|
| reference breakdown | yes (2D-oriented) | — | — | **adapted** (scdet shots + ReelMimic camera/look method + pacing params) |
| footage understanding | — | source review prompts | heuristics + ranking | reused + dense 12 fps tracking, tech/editorial split |
| plan / timeline | plan.json (2D shots) | edit_decisions schema | EditPlan + EDL | **new** bbm-timeline/1 + OTIO/FCPXML; EDL via existing writer |
| reframe 9:16 | — | face-tracked crop | — | **new**: movement-extent crop or fit-over-blur (both athletes) |
| stabilise | — | — | — | **new** (vid.stab, selective) |
| captions | HyperFrames (Latin/CJK) | SRT/VTT burn | — | **new** ASS + Noto Arabic, auto-RTL, verified visually |
| audio mix | — | duck + loudnorm | — | **new** (sidechain duck + two-pass loudnorm, level matching) |
| render | headless Chrome canvas | Remotion/HyperFrames/FFmpeg | — | **new** FFmpeg segment cache |
| review loop | agent critique, bounded rounds | reviewer prompt | review.csv | **adapted**: measured QC + independent reviewer agent + ops + evidence, bounded |
| resumable jobs | job.json stage machine | checkpoint JSON | — | **new** fingerprinted stages, cancel/timeout/retry |

## Reused, file by file
- **ReelMimic (MIT)** → `bjj_pipeline/studio/reference.py::shot_details` adapts
  `_shot_details_part` (median optical flow on textured pixels → pan/tilt/zoom/rotate, pace classes,
  brightness/contrast/dark ratio/colourfulness). Attribution is in the module docstring and
  function docstring. Also adopted as *ideas*: timestamped contact sheets as review evidence,
  "measure first, then let an agent judge from sheets", bounded review rounds with blocker vs
  polish findings, revise-only-affected-shots. No ReelMimic TypeScript was copied; none of the
  Apache-2.0 HyperFrames skills were copied.
- **agency-agents (MIT)** → six adapted roles in `.claude/agents/bbm-*.md`, each with an
  attribution comment naming its source file(s): reality-checker + model-qa → `bbm-reviewer`;
  short-video-editing-coach → `bbm-editor`, `bbm-audio-captions` (-14 LUFS, caption timing/safe
  areas), `bbm-footage-selector` (asset assessment; sports rules are new); visual-storyteller →
  `bbm-creative-director`; sre → `bbm-reliability`. Nothing else installed.
- **OpenMontage (AGPL-3.0)** → **no code copied or imported.** Only general, widely known techniques
  that OpenMontage also uses (FFmpeg `sidechaincompress` ducking, `loudnorm`, scene thresholds,
  crop windows) were implemented independently from FFmpeg documentation. Reasons: AGPL would
  make this MIT package (and the web app repo it lives in) AGPL, including the network clause
  (§13); running it as a separate process does not by itself settle that question, and the useful
  local pieces are small. If an OpenMontage tool is ever wanted, run an unmodified checkout as an
  optional external tool, keep its licence and notices with it, and get a licensing opinion first.

## Updating
1. `git clone https://github.com/<owner>/<repo> && git -C <repo> log -1` — note the new commit.
2. ReelMimic: `git diff 782a3ba3 <new> -- .claude/skills/video-clone/scripts/analyze.py` and port any
   change to `_shot_details_part` by hand into `studio/reference.py::shot_details`; bump `REF_VERSION`.
3. agency-agents: `git diff 652b2692 <new> -- testing/testing-reality-checker.md specialized/specialized-model-qa.md
   marketing/marketing-short-video-editing-coach.md design/design-visual-storyteller.md engineering/engineering-sre.md`
   and merge useful directives into the matching `.claude/agents/bbm-*.md`.
4. OpenMontage: read release notes only; do not copy code (see above).
5. Update the commit table above, run `python -m pytest -q -p no:cacheprovider` in `resolve-ai/bjj`.
