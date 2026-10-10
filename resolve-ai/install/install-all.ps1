<#
.SYNOPSIS
  One-shot, idempotent installer for the Blue Belt Media DaVinci Resolve AI editing ecosystem.

.DESCRIPTION
  Order: inventory -> backup -> MCP servers (+ register primary) -> skills -> analysis layer ->
  (video-ad-editor: explained skip) -> verify.  Re-running is safe: clones are fetched not reset,
  venvs reused, existing configs backed up and never replaced without -ReplaceExisting.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\BlueBelt\blue-belt\resolve-ai\install\install-all.ps1
  powershell -ExecutionPolicy Bypass -File ...\install-all.ps1 -WithGpuExtras -Primary gursky
#>
[CmdletBinding()]
param(
    [ValidateSet('gursky','cipriano','guycochran')][string]$Primary = 'gursky',
    [switch]$WithGpuExtras,
    [switch]$ReplaceExisting,
    [switch]$SkipAlternates,
    [switch]$InventoryOnly
)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Stop'
$root = New-DirectorySafe (Get-ToolsRoot)
Write-Log "=== Blue Belt Media Resolve-AI installer -> $root ===" 'STEP'
if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5.1 or PowerShell 7 required' }

& (Join-Path $PSScriptRoot '00-inventory.ps1')
if ($InventoryOnly) { exit 0 }
$inv = Get-Content (Join-Path $root 'inventory\inventory-latest.json') -Raw | ConvertFrom-Json
if ($inv.conflicts.Count) {
    Write-Log 'Inventory reported conflicts:' 'WARN'
    $inv.conflicts | ForEach-Object { Write-Log "  - $_" 'WARN' }
    $hard = $inv.conflicts | Where-Object { $_ -match 'Git not found|No Python found|Only .* GB free' }
    if ($hard) { throw 'Fix the conflicts above (git / python / disk) and re-run.' }
}

& (Join-Path $PSScriptRoot '01-backup-config.ps1') | Out-Null
& (Join-Path $PSScriptRoot '02-install-mcp.ps1') -Primary $Primary -ReplaceExisting:$ReplaceExisting -SkipAlternates:$SkipAlternates
& (Join-Path $PSScriptRoot '03-install-skills.ps1')
& (Join-Path $PSScriptRoot '04-install-analysis.ps1') -WithGpuExtras:$WithGpuExtras
& (Join-Path $PSScriptRoot '05-install-video-ad-editor.ps1')
& (Join-Path $PSScriptRoot '06-verify.ps1')

# launcher shortcut
$launcher = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\launcher')).Path 'bbm-video.cmd'
$bin = New-DirectorySafe (Join-Path $root 'bin')
@"
@echo off
call "$launcher" %*
"@ | Set-Content (Join-Path $bin 'bbm-video.cmd') -Encoding ASCII
Write-Log "Done. Run 'bbm-video' (new terminal) or $launcher for the launcher; see resolve-ai\docs\MANUAL-STEPS.md for the Resolve settings you must set by hand." 'OK'
exit 0
