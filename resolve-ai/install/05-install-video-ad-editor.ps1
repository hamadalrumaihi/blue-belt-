<#
.SYNOPSIS
  majedphotos/video-ad-editor: evaluated, NOT installed by default. This script explains why and
  can clone it read-only for reference (-CloneOnly) or install the plugin if you insist (-InstallPlugin).

.DESCRIPTION
  Findings (full detail in docs/REPORT.md):
    * It is a Claude Code plugin ("majed-video") of six Arabic-first skills for talking-head
      Instagram reels (silence cut, word-timed Arabic captions, SFX, loudness, CapCut writer).
    * Its davinci-video skill triggers on bare "DaVinci"/"Resolve" and overlaps the Resolve skills
      installed by 03-install-skills.ps1, so both would fire on the same prompts.
    * scripts/00_setup.sh self-updates over the network on every run and `--extras` runs an
      unpinned `pip install torch` that can replace a CUDA torch with the CPU wheel.
    * Its Resolve scripts need an MCP tool named run_script_unsafe (not present in our primary).
    * It exports JSON cut plans (cut.json / caps.json), not EDL/XML. bjj-pipeline ships an adapter:
        bjj adapters vae-plan <work-dir> --out <name>   -> CMX3600 EDL + CSV
        bjj adapters vae-srt  <work-dir> --out captions.srt
#>
[CmdletBinding()]
param([switch]$CloneOnly, [switch]$InstallPlugin)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Stop'
$dir = Join-Path (Get-ToolsRoot) 'reference\video-ad-editor'
if ($CloneOnly -or $InstallPlugin) {
    New-DirectorySafe (Split-Path $dir) | Out-Null
    if (-not (Test-Path (Join-Path $dir '.git'))) { Invoke-Checked -File 'git' -Arguments @('clone', '--depth', '1', 'https://github.com/majedphotos/video-ad-editor', $dir) }
    Write-Log "cloned read-only to $dir (nothing executed)" 'OK'
}
if ($InstallPlugin) {
    if (-not (Test-ClaudeCli)) { throw 'claude CLI not found' }
    & (Join-Path $PSScriptRoot '01-backup-config.ps1') | Out-Null
    Write-Log 'Installing the majed-video plugin via the Claude plugin marketplace (user scope). Do NOT run its scripts/00_setup.sh --extras in the bjj-pipeline venv.' 'WARN'
    & claude plugin marketplace add majedphotos/video-ad-editor 2>&1 | ForEach-Object { Write-Log "  $_" }
    & claude plugin install majed-video@majed-video 2>&1 | ForEach-Object { Write-Log "  $_" }
    Write-Log 'Installed. Expect skill-trigger overlap with resolve-* / davinci-resolve* skills on "DaVinci" prompts.' 'WARN'
    exit 0
}
Write-Log 'video-ad-editor: SKIPPED by design (see header). Use -CloneOnly to keep a reference copy, -InstallPlugin to install anyway.' 'WARN'
exit 0
