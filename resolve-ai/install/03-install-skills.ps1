<#
.SYNOPSIS
  Install reviewed Claude Code skills into %USERPROFILE%\.claude\skills (user scope) and verify discovery.

.DESCRIPTION
  Sources (all reviewed in docs/SKILLS-CATALOG.md; none contain hooks or install-time scripts):
    * CiprianSpiridon/davinci-resolve-mcp  skills/  -> davinci-resolve, davinci-resolve-use-plugins,
      davinci-resolve-generate-plugin-list, davinci-resolve-remove-silences-bad-takes-and-umms
      (pair with the CiprianSpiridon server: `switch-mcp.ps1 -To cipriano`)
    * samuelgursky/davinci-resolve-mcp .claude/skills/ -> resolve-mcp, resolve-edit, resolve-color,
      resolve-delivery, resolve-media-pool, resolve-media-analysis, resolve-rough-cut, resolve-session,
      resolve-tighten-recording, resolve-audio, resolve-fusion, resolve-conform
      (pair with the primary server). house-style / release-check are intentionally skipped.
    * This repository .claude/skills/ -> bjj-analyze, bjj-highlights, bjj-reel, bjj-club, bjj-cleanup,
      bjj-color, bjj-export, resolve-health (server-agnostic)
    * majedphotos/claude-skills -> evaluated, nothing installed (one Meta-Ads skill, not relevant)

  Existing skills with the same name are backed up, never silently overwritten (use -Overwrite).
  Copies of the samuelgursky skills get one extra line pointing at the clone's docs/ folder because
  their text references repo-relative files.
#>
[CmdletBinding()]
param([switch]$Overwrite, [switch]$SkipUpstream, [switch]$SkipBjj)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Stop'
$cp = Get-ClaudeConfigPaths
$dest = New-DirectorySafe $cp.user_skills_dir
$mcpRoot = Join-Path (Get-ToolsRoot) 'mcp'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backupDir = Join-Path (Get-ToolsRoot) ("backups\skills-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Write-Log "Installing skills -> $dest" 'STEP'

$installed = @(); $skipped = @()

function Install-Skill {
    param([string]$Src, [string]$Name, [string]$Origin, [string]$DocsNote = $null)
    if (-not (Test-Path -LiteralPath (Join-Path $Src 'SKILL.md'))) { $script:skipped += "$Name (no SKILL.md at $Src)"; return }
    # safety review: refuse skills that declare hooks or that carry executable install hooks
    $fm = (Get-Content -LiteralPath (Join-Path $Src 'SKILL.md') -Raw)
    if ($fm -match '(?m)^hooks:') { $script:skipped += "$Name (declares hooks: review manually)"; Write-Log "skip $Name: declares hooks" 'WARN'; return }
    $target = Join-Path $dest $Name
    if (Test-Path -LiteralPath $target) {
        $same = (Get-Content -LiteralPath (Join-Path $target 'SKILL.md') -Raw -ErrorAction SilentlyContinue) -eq $fm
        if (-not $Overwrite -and -not $same -and -not ((Get-Content -LiteralPath (Join-Path $target 'SKILL.md') -Raw -ErrorAction SilentlyContinue) -match 'Upstream docs root')) {
            $script:skipped += "$Name (exists with different content; use -Overwrite)"; Write-Log "skip $Name: exists and differs" 'WARN'; return
        }
        New-DirectorySafe $backupDir | Out-Null
        Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir $Name) -Recurse -Force
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    Copy-Item -LiteralPath $Src -Destination $target -Recurse -Force
    # drop caches / symlink leftovers
    Get-ChildItem -LiteralPath $target -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    if ($DocsNote) {
        $skill = Join-Path $target 'SKILL.md'
        $text = Get-Content -LiteralPath $skill -Raw
        if ($text -match '(?s)^---\r?\n.*?\r?\n---\r?\n') {
            $text = $text -replace '(?s)^(---\r?\n.*?\r?\n---\r?\n)', ('$1' + "`n> Upstream docs root (repo-relative paths below live here): $DocsNote`n")
            Set-Content -LiteralPath $skill -Value $text -Encoding UTF8 -NoNewline
        }
    }
    $script:installed += [ordered]@{ name = $Name; origin = $Origin; path = $target }
    Write-Log "installed $Name  ($Origin)" 'OK'
}

if (-not $SkipUpstream) {
    $cDir = Join-Path $mcpRoot 'davinci-resolve-mcp-cipriano'
    if (Test-Path -LiteralPath (Join-Path $cDir 'skills')) {
        foreach ($n in 'davinci-resolve','davinci-resolve-use-plugins','davinci-resolve-generate-plugin-list','davinci-resolve-remove-silences-bad-takes-and-umms') {
            Install-Skill (Join-Path $cDir "skills\$n") $n 'CiprianSpiridon/davinci-resolve-mcp'
        }
    } else { Write-Log "CiprianSpiridon clone not found at $cDir (run 02-install-mcp.ps1); skipping its skills" 'WARN' }

    $gDir = Join-Path $mcpRoot 'davinci-resolve-mcp-gursky'
    if (Test-Path -LiteralPath (Join-Path $gDir '.claude\skills')) {
        foreach ($n in 'resolve-mcp','resolve-edit','resolve-color','resolve-delivery','resolve-media-pool','resolve-media-analysis',
                       'resolve-rough-cut','resolve-session','resolve-tighten-recording','resolve-audio','resolve-fusion','resolve-conform') {
            Install-Skill (Join-Path $gDir ".claude\skills\$n") $n 'samuelgursky/davinci-resolve-mcp' $gDir
        }
    } else { Write-Log "samuelgursky clone not found at $gDir; skipping its skills" 'WARN' }
}

if (-not $SkipBjj) {
    foreach ($n in 'bjj-analyze','bjj-highlights','bjj-reel','bjj-club','bjj-cleanup','bjj-color','bjj-export','resolve-health') {
        Install-Skill (Join-Path $repoRoot ".claude\skills\$n") $n 'blue-belt repo'
    }
}

# ---------------------------------------------------------------- verify discovery
$present = @(Get-ChildItem -LiteralPath $dest -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'SKILL.md') } | Select-Object -ExpandProperty Name)
$report = [ordered]@{ generated = (Get-Date).ToString('s'); skills_dir = $dest; installed = $installed; skipped = $skipped; discoverable = $present }
if (Test-ClaudeCli) {
    # Non-interactive discovery check: ask Claude to list its skills (cheap prompt). Needs a signed-in CLI.
    try {
        $probe = (Invoke-Native -File (Get-ClaudeCliPath) -Arguments @('-p', 'List the names of the skills available to you that start with "bjj-" or "resolve-" or "davinci-resolve". Output only the names, one per line.', '--max-turns', '1')) -join "`n"
        $report['claude_probe'] = $probe.Trim()
        $seen = @($installed | Where-Object { $probe -match [regex]::Escape($_.name) } | ForEach-Object { $_.name })
        $report['probe_confirmed'] = $seen
        Write-Log ("claude -p discovery confirmed {0}/{1} installed skills" -f $seen.Count, $installed.Count) $(if ($seen.Count -eq $installed.Count) {'OK'} else {'WARN'})
    } catch { $report['claude_probe'] = "probe failed: $_" }
}
$out = Join-Path (Get-ToolsRoot) 'inventory\skills-install.json'
New-DirectorySafe (Split-Path $out) | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $out -Encoding UTF8
Write-Log ("installed {0}, skipped {1}; report {2}" -f $installed.Count, $skipped.Count, $out) 'OK'
if ($skipped.Count) { $skipped | ForEach-Object { Write-Log "  skipped: $_" 'WARN' } }
Write-Log 'Open a NEW Claude Code session and type / to see the skills (bjj-analyze, resolve-health, ...).'
exit 0
