---
name: bbm-studio-dev
description: >-
  Maintain, extend or debug the BBM Studio video-production system itself (resolve-ai/bjj/bjj_pipeline/studio:
  ingest, footage analysis, reference breakdown, planner, timeline schema, FFmpeg renderer, QC, revisions,
  exports, local UI, Windows launcher) and its upstream-derived parts (ReelMimic, agency-agents, OpenMontage).
  Use when H asks to add a feature or check to the video pipeline, fix a failing stage, change render/QC
  behaviour, update from the upstream repos, or "continue building the video system" - not for making
  a video (that is bbm-studio).
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# BBM Studio — engineering

Start every session with: `resolve-ai/docs/STUDIO-STATUS.md` (what works, limits, next actions),
then `resolve-ai/docs/STUDIO.md` (architecture), then the module you will touch. Upstream provenance
and licences: `resolve-ai/docs/UPSTREAM.md`.

## Map
```
resolve-ai/bjj/bjj_pipeline/          existing MIT package (probe, heuristic analysis, ranking, EDL, Resolve bridge)
  studio/project.py    project folder, schema v1, stage checkpoints, fingerprints, cancel flag
  studio/jobs.py       run_tool (cancel/timeout/retry/logs/actionable errors), stage() context manager
  studio/ingest.py     discover, probe, decode-test, hash, proxies, sheets, duplicates, audio-overlap groups
  studio/footage.py    coarse analysis (bjj analyze) + dense 12 fps movement tracking, technical vs editorial scores
  studio/reference.py  scdet shots, per-shot camera/look (ReelMimic-derived, MIT), pacing params
  studio/planner.py    brief + candidates (+ref params) -> timeline v1 (sports rules live here)
  studio/timeline.py   bbm-timeline/1 schema, layout, validation, caption reflow, OTIO/FCPXML/EDL export
  studio/render.py     per-clip segment cache, assembly, captions (libass), music ducking, 2-pass loudnorm
  studio/captions.py   ASS writer; Noto Sans / Noto Sans Arabic; Encoding -1 = auto RTL
  studio/qc.py         measurements on the rendered file + evidence sheets
  studio/revise.py     feedback, ops, bounded rounds, evidence, QC-proposed ops
  studio/export.py     final render + manifest + NLE files
  studio/health.py     measured environment report;  studio/ui.py local UI;  studio/cli.py `bjj studio`
resolve-ai/bjj/tests/test_studio.py    synthetic-media tests (mechanics, not editing quality)
resolve-ai/launcher/bbm-studio.{cmd,ps1}   Windows launch path
.claude/agents/bbm-*.md                specialist roles;  .claude/skills/bbm-studio/  production workflow
```

## Invariants (do not break)
1. Originals are read-only. Proxies/analysis/renders live in the project folder outside git.
2. One authoritative timeline per production, written only via `timeline.save_version` (planner,
   revise). Versions are append-only; clip ids stay stable across revisions.
3. Every stage goes through `jobs.stage()` with a fingerprint of its INPUTS. If you change what a
   module computes, bump its version constant (ANALYSIS_VERSION, REF_VERSION, PLAN_VERSION,
   RENDER_VERSION, QC_VERSION) or old caches will be reused.
4. Every external tool call goes through `run_tool` (cancel, timeout, log, actionable error).
5. QC measures the rendered file. Never add an "overall quality score".
6. No claims of athlete identity / technique / score / winner from signals.
7. No code copied from OpenMontage (AGPL-3.0). ReelMimic (MIT) code may be adapted with the
   attribution comment pattern used in reference.py. Agency-agents (MIT) prompts: attribution comment
   at the top of each agent file.
8. Nothing uploads footage or calls a paid service without an explicit user yes.

## Adding things
- **QC check**: add to `qc.run_qc` with `_check(id, status, title, value, expected, at=[{t, clip}], detail,
  evidence)`; map times to clips with `_clip_label`; bump QC_VERSION; add a test that renders a fixture
  exhibiting the defect and asserts the check fails at the right timestamp.
- **Revision op**: implement in `revise.apply_ops`, document in `.claude/skills/bbm-studio/references/ops.md`,
  test that only the targeted clip's segment re-renders.
- **Planner rule**: implement in `planner.build_timeline`, explain the rule in the module docstring,
  add an assertion to `test_plan_respects_sports_rules`.
- **Stage**: add to `project.STAGES`, wrap with `stage()`, call from `pipeline.run`, show in the UI.

## Verify
```
cd resolve-ai/bjj && python -m pytest -q -p no:cacheprovider        # all tests (existing + studio)
bjj studio health                                                    # this machine, measured
```
Then render a fixture production and LOOK at `qc/<render>/sheet.jpg` and caption frames — Arabic
regressions (boxes, wrong RTL order) only show up visually. Update STUDIO-STATUS.md (what changed,
what is verified where, next actions) before you finish.

## Updating upstream-derived parts
Follow resolve-ai/docs/UPSTREAM.md: fetch the upstream repo at a new commit, diff only the files
listed there, port changes by hand, update the recorded commit, re-run tests.
