# resolve-ai — Blue Belt Media video tooling

- **Making a video** (highlight, recap, reel, promo, fight edit, revisions, export): use the
  `bbm-studio` skill (`.claude/skills/bbm-studio/`). CLI: `bjj studio ...`.
- **Changing the video system**: use the `bbm-studio-dev` skill. Read `docs/STUDIO-STATUS.md` first.
- **Resolve-only timeline prep** (no render): the `bjj-*` skills and `bjj plan/resolve` (docs/WORKFLOW.md).

Authoritative docs: `docs/STUDIO.md` (architecture), `docs/STUDIO-STATUS.md` (verified / limits /
next actions), `docs/UPSTREAM.md` (ReelMimic, agency-agents, OpenMontage provenance + licences),
`docs/REPORT.md` (original Resolve-AI setup).

Rules that apply everywhere here:
- Verify the machine before claiming a capability: `bjj studio health` (FFmpeg flags, real encodes,
  Resolve edition from the live API). A cloud session cannot see the Windows editing PC's drives.
- Footage, proxies, renders and project folders never go into git (they live in `BBM_STUDIO_HOME`).
- Ask before paid jobs, uploading footage, or publishing. Everything in `bjj studio` is local.
- No code from OpenMontage (AGPL-3.0) in this MIT package.
- Tests: `cd resolve-ai/bjj && python -m pytest -q -p no:cacheprovider` (synthetic media only).
