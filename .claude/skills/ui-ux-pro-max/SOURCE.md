# Source

Vendored from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
(MIT, see LICENSE) at commit 477bcb2, plugin version 2.13.0.

Installed as a project skill (the layout `uipro init --ai claude` produces):
script paths in SKILL.md point at `.claude/skills/ui-ux-pro-max/scripts/`
relative to the repository root instead of `${CLAUDE_PLUGIN_ROOT}`.
The upstream developer test suite (scripts/tests) is not included.
Local only: the scripts read the bundled CSV data and need no network or API keys.

Update by re-copying `.claude/skills/ui-ux-pro-max/` from a newer upstream
release and re-applying the path rewrite.
