<#
.SYNOPSIS
  Blue Belt Media - central launcher for the DaVinci Resolve AI editing ecosystem.

.DESCRIPTION
  A small interactive menu (no web app): integrations, active MCP server, health, footage
  analysis, highlight plans, Resolve project preparation, export presets, troubleshooting, logs.
  Every action shells out to the same `bjj` CLI and install scripts the Claude skills use, so
  what you see here is exactly what Claude does.

  Non-interactive: bbm-video.ps1 -Action health | status | analyze | plan | build | presets | logs
#>
[CmdletBinding()]
param(
    [ValidateSet('menu','status','health','analyze','plan','build','presets','troubleshoot','logs','switch')][string]$Action = 'menu',
    [string]$Path, [string]$Out, [string]$Template = 'cinematic', [string]$Name = 'Highlight', [string]$Plan, [string]$Project
)
$installDir = (Resolve-Path (Join-Path $PSScriptRoot '..\install')).Path
Import-Module (Join-Path $installDir 'Common.psm1') -Force
$root = Get-ToolsRoot
$bjj = Join-Path $root 'bin\bjj.cmd'
$logDir = Get-LogDir
New-DirectorySafe $logDir | Out-Null
$sessionLog = Join-Path $logDir ("launcher-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

function Say { param($t, $c = 'Gray') Write-Host $t -ForegroundColor $c; Add-Content $sessionLog "$(Get-Date -Format 'HH:mm:ss') $t" }
function Have-Bjj { if (-not (Test-Path $bjj)) { Say "bjj-pipeline not installed: run install\04-install-analysis.ps1" 'Yellow'; return $false }; return $true }
function Run-Bjj { param([string[]]$Args) Say ("> bjj " + ($Args -join ' ')) 'DarkGray'; & $bjj @Args 2>&1 | Tee-Object -FilePath $sessionLog -Append }

function Show-Status {
    Say '--- Integrations ---' 'Cyan'
    $r = Get-ResolveInstall
    Say ("DaVinci Resolve : {0} {1} {2}" -f $(if ($r.installed) {'installed'} else {'NOT installed'}), $r.edition, $r.version) $(if ($r.installed) {'Green'} else {'Red'})
    Say ("Resolve running : {0}" -f (Test-ResolveRunning))
    $regPath = Join-Path $root 'mcp\servers.json'
    if (Test-Path $regPath) {
        $reg = Get-Content $regPath -Raw | ConvertFrom-Json
        $active = Get-ClaudeMcpServers
        $act = if ($active.ContainsKey('davinci-resolve')) { $active['davinci-resolve'].command } else { '(none)' }
        foreach ($k in $reg.servers.PSObject.Properties.Name) {
            $s = $reg.servers.$k
            $mark = if ($s.command -eq $act) { 'ACTIVE ' } else { '       ' }
            Say ("MCP {0}{1,-11} {2}  [{3}]" -f $mark, $k, $s.tools, $s.dir)
        }
    } else { Say 'MCP servers     : not installed (install\02-install-mcp.ps1)' 'Yellow' }
    $skills = (Get-ClaudeConfigPaths).user_skills_dir
    $n = @(Get-ChildItem $skills -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'bjj-*' -or $_.Name -like 'resolve-*' -or $_.Name -like 'davinci-resolve*' }).Count
    Say ("Claude skills   : {0} Resolve/BJJ skills in {1}" -f $n, $skills)
    $a = Join-Path $root 'analysis\analysis.json'
    if (Test-Path $a) { $aj = Get-Content $a -Raw | ConvertFrom-Json; Say ("Analysis        : bjj-pipeline + HypeCut ({0})" -f $aj.hypecut.exe) } else { Say 'Analysis        : not installed (install\04-install-analysis.ps1)' 'Yellow' }
    Say ("Tools root      : {0}" -f $root)
}

function Show-Health {
    Say '--- Health ---' 'Cyan'
    if (Test-ClaudeCli) { & claude mcp list 2>&1 | ForEach-Object { Say "  $_" } } else { Say '  claude CLI not found' 'Yellow' }
    if (Have-Bjj) { Run-Bjj @('doctor') }
    & (Join-Path $installDir '06-verify.ps1') | Out-Null
    Say ("full table: {0}" -f (Join-Path $root 'inventory\verify-latest.md'))
}

function Do-Analyze {
    if (-not (Have-Bjj)) { return }
    if (-not $Path) { $Path = Read-Host 'Folder (or file) with footage' }
    if (-not $Out) { $Out = Read-Host 'Output folder for the analysis (e.g. <tournament>\_analysis\run1)' }
    $hc = if ($env:BJJ_HYPECUT -or (Test-Path (Join-Path $root 'bin\hypecut.cmd'))) { @('--hypecut') } else { @() }
    Run-Bjj (@('analyze', $Path, '--out', $Out, '--contact-sheets') + $hc)
    Say "Open $Out\report.md and fill in review.csv before planning." 'Green'
}

function Do-Plan {
    if (-not (Have-Bjj)) { return }
    if (-not $Path) { $Path = Read-Host 'Analysis folder (the --out of analyze)' }
    $review = Join-Path $Path 'review.csv'
    $args = @('plan', '--analysis', $Path, '--template', $Template, '--name', $Name)
    if (Test-Path $review) { $args += @('--review', $review) }
    Run-Bjj $args
}

function Do-Build {
    if (-not (Have-Bjj)) { return }
    if (-not $Plan) { $Plan = Read-Host 'Plan file (*.plan.json)' }
    if (-not $Project) { $Project = Read-Host 'Resolve project name to CREATE (existing names get a -2 suffix, never overwritten)' }
    Say 'Render jobs are queued but never started from here.' 'Yellow'
    Run-Bjj @('resolve', 'build', '--plan', $Plan, '--project', $Project)
}

function Do-Troubleshoot {
    Say '--- Troubleshooting ---' 'Cyan'
    $r = Get-ResolveInstall
    if (-not $r.installed) { Say '1. Install DaVinci Resolve (Studio needed for scripting): https://www.blackmagicdesign.com/products/davinciresolve' 'Yellow' }
    elseif ($r.edition -ne 'Studio') { Say "1. Edition '$($r.edition)': external scripting is Studio-only. MCP tools will refuse to connect. EDL import still works manually." 'Yellow' }
    if (-not (Test-ResolveRunning)) { Say '2. Resolve is not running. Start it and open/create a project.' 'Yellow' }
    Say '3. In Resolve: Preferences > System > General > External scripting using = Local (restart Resolve).'
    Say '4. Check the active server:  install\switch-mcp.ps1 -Status'
    Say '5. Direct API test (no MCP):  bjj resolve status'
    Say '6. Logs: ' + $logDir
    Say '7. Re-run the verifier:        install\06-verify.ps1'
    Say '8. Restore a config backup from: ' + (Join-Path $root 'backups')
    if (Have-Bjj) { Run-Bjj @('resolve', 'status') }
}

function Show-Logs {
    Get-ChildItem $logDir -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 10 | ForEach-Object { Say ("{0}  {1,8} KB  {2}" -f $_.LastWriteTime, [math]::Round($_.Length / 1KB), $_.FullName) }
    $latest = Get-ChildItem $logDir -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) { Say "--- tail of $($latest.Name) ---" 'Cyan'; Get-Content $latest.FullName -Tail 40 | ForEach-Object { Write-Host "  $_" } }
}

switch ($Action) {
    'status'       { Show-Status; exit 0 }
    'health'       { Show-Health; exit 0 }
    'analyze'      { Do-Analyze; exit 0 }
    'plan'         { Do-Plan; exit 0 }
    'build'        { Do-Build; exit 0 }
    'presets'      { if (Have-Bjj) { Run-Bjj @('presets', '--list') }; exit 0 }
    'troubleshoot' { Do-Troubleshoot; exit 0 }
    'logs'         { Show-Logs; exit 0 }
    'switch'       { & (Join-Path $installDir 'switch-mcp.ps1') -Status; exit 0 }
}

while ($true) {
    Write-Host ''
    Write-Host '  Blue Belt Media - Resolve AI launcher' -ForegroundColor Cyan
    Write-Host '  1  Integrations + active MCP server      6  Export presets (Reel / Story / YouTube / Master)'
    Write-Host '  2  Connection health (claude mcp list)   7  Switch active MCP server'
    Write-Host '  3  Analyze footage (Stage A-C report)    8  Troubleshooting'
    Write-Host '  4  Highlight plan (EDL + cut list)       9  Logs'
    Write-Host '  5  Prepare Resolve project / timeline    0  Quit'
    $c = Read-Host '  choose'
    switch ($c) {
        '1' { Show-Status }
        '2' { Show-Health }
        '3' { $Path = $null; $Out = $null; Do-Analyze }
        '4' { $Path = $null; $Template = Read-Host 'template (cinematic | high_energy | full_highlights | club_recap)'; $Name = Read-Host 'plan name'; Do-Plan }
        '5' { $Plan = $null; $Project = $null; Do-Build }
        '6' { if (Have-Bjj) { Run-Bjj @('presets', '--list') } }
        '7' { $to = Read-Host 'switch to (gursky | cipriano | guycochran)'; & (Join-Path $installDir 'switch-mcp.ps1') -To $to }
        '8' { Do-Troubleshoot }
        '9' { Show-Logs }
        '0' { exit 0 }
        default { Say 'unknown choice' 'Yellow' }
    }
}
