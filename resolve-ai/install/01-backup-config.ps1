<#
.SYNOPSIS
  Back up every Claude Code / Claude Desktop / Resolve configuration file the installers may touch.
  Nothing is modified. Backups go to C:\AI-Video-Tools\backups\<timestamp>\.
#>
[CmdletBinding()]
param([string]$BackupRoot = $null)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
if (-not $BackupRoot) { $BackupRoot = Join-Path (Get-ToolsRoot) 'backups' }
$dir = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
New-DirectorySafe $dir | Out-Null
Write-Log "Backing up configuration to $dir" 'STEP'

$cp = Get-ClaudeConfigPaths
$targets = @(
    $cp.user_claude_json, $cp.user_settings, $cp.user_skills_dir, $cp.user_commands_dir, $cp.user_agents_dir, $cp.claude_desktop_cfg,
    (Join-Path $env:USERPROFILE '.claude\keybindings.json'),
    (Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Preferences\config.user.xml'),
    (Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Preferences\DaVinci Resolve.prefs')
)
# project-level config next to this repo (the .mcp.json the user already has)
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
foreach ($f in '.mcp.json', '.claude\settings.json', '.claude\settings.local.json', 'CLAUDE.md') {
    $p = Join-Path $repoRoot $f
    if (Test-Path -LiteralPath $p) { $targets += $p }
}

$manifest = @()
foreach ($t in $targets) {
    if (Test-Path -LiteralPath $t) {
        $sub = Join-Path $dir (($t -replace '[:\\]', '_').TrimStart('_'))
        New-DirectorySafe (Split-Path $sub -Parent) | Out-Null
        if (Test-Path -LiteralPath $t -PathType Container) { Copy-Item -LiteralPath $t -Destination $sub -Recurse -Force }
        else { Copy-Item -LiteralPath $t -Destination $sub -Force }
        $manifest += [ordered]@{ source = $t; backup = $sub }
        Write-Log "backed up $t" 'OK'
    }
}
@{ created = (Get-Date).ToString('s'); files = $manifest } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $dir 'manifest.json') -Encoding UTF8
Write-Log "Backup complete: $($manifest.Count) item(s). Restore by copying files back from $dir" 'OK'
Write-Output $dir
