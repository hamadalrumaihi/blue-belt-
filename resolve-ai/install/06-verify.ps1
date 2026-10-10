<#
.SYNOPSIS
  Smoke-test every installed component and write a status table that separates
  "installed" from "verified against a running DaVinci Resolve".

.DESCRIPTION
  Writes C:\AI-Video-Tools\inventory\verify-latest.json and verify-latest.md.
  Status vocabulary: installed | configured | verified | requires-manual-setup | unsupported | skipped
#>
[CmdletBinding()]
param()
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Continue'
$root = Get-ToolsRoot
$rows = @()
function Add-Row { param($Component, $Status, $Detail) $script:rows += [ordered]@{ component = $Component; status = $Status; detail = $Detail } }

$resolve = Get-ResolveInstall
$running = Test-ResolveRunning
if (-not $resolve.installed) { Add-Row 'DaVinci Resolve' 'requires-manual-setup' 'not installed' }
else { Add-Row 'DaVinci Resolve' $(if ($resolve.edition -eq 'Studio') {'installed'} else {'unsupported'}) "edition=$($resolve.edition) version=$($resolve.version) running=$running (external scripting needs Studio)" }

# --- MCP servers
$regPath = Join-Path $root 'mcp\servers.json'
$reg = if (Test-Path $regPath) { Get-Content $regPath -Raw | ConvertFrom-Json } else { $null }
$active = Get-ClaudeMcpServers
if ($reg) {
    foreach ($k in $reg.servers.PSObject.Properties.Name) {
        $s = $reg.servers.$k
        $ok = Test-Path -LiteralPath $s.command
        $isActive = $active.ContainsKey('davinci-resolve') -and ($active['davinci-resolve'].command -eq $s.command)
        $status = if (-not $ok) {'requires-manual-setup'} elseif ($isActive) {'configured'} else {'installed'}
        Add-Row "MCP: $k" $status "$($s.tools); $(if ($isActive) {'ACTIVE as davinci-resolve'} else {'available via switch-mcp.ps1'})"
    }
} else { Add-Row 'MCP servers' 'skipped' 'servers.json missing: run 02-install-mcp.ps1' }

if (Test-ClaudeCli) {
    $list = (Invoke-Native -File (Get-ClaudeCliPath) -Arguments @('mcp', 'list')) -join "`n"
    $line = ($list -split "`n" | Where-Object { $_ -match 'davinci-resolve' } | Select-Object -First 1)
    if ($line -match 'Connected') { Add-Row 'MCP: live connection' 'verified' $line.Trim() }
    elseif ($line) { Add-Row 'MCP: live connection' $(if ($running -and $resolve.edition -eq 'Studio') {'requires-manual-setup'} else {'requires-manual-setup'}) ($line.Trim() + ' | needs Resolve Studio running + Preferences > System > General > External scripting using = Local') }
    else { Add-Row 'MCP: live connection' 'requires-manual-setup' 'no davinci-resolve server registered' }
} else { Add-Row 'Claude Code CLI' 'requires-manual-setup' 'claude not on PATH' }

# --- skills
$skillsDir = (Get-ClaudeConfigPaths).user_skills_dir
$expected = 'bjj-analyze','bjj-highlights','bjj-reel','bjj-club','bjj-cleanup','bjj-color','bjj-export','resolve-health','davinci-resolve','davinci-resolve-use-plugins','davinci-resolve-generate-plugin-list','davinci-resolve-remove-silences-bad-takes-and-umms','resolve-mcp','resolve-edit','resolve-color','resolve-delivery'
$have = @(); $missing = @()
foreach ($n in $expected) { if (Test-Path (Join-Path $skillsDir "$n\SKILL.md")) { $have += $n } else { $missing += $n } }
Add-Row 'Claude skills' $(if ($missing.Count -eq 0) {'installed'} elseif ($have.Count) {'installed'} else {'skipped'}) "present: $($have.Count)/$($expected.Count)$(if ($missing) { '; missing: ' + ($missing -join ', ') })"

# --- analysis layer
$aPath = Join-Path $root 'analysis\analysis.json'
if (Test-Path $aPath) {
    $a = Get-Content $aPath -Raw | ConvertFrom-Json
    $bjj = Join-Path $root 'bin\bjj.cmd'
    if (Test-Path $bjj) {
        $doc = (Invoke-Native -File $bjj -Arguments @('doctor', '--no-resolve')) -join ' '
        $doc = $doc -replace '\s+', ' '
        Add-Row 'bjj-pipeline' $(if ((Get-LastNativeExitCode) -eq 0) {'verified'} else {'installed'}) $doc.Substring(0, [Math]::Min(200, $doc.Length))
    } else { Add-Row 'bjj-pipeline' 'skipped' 'bin\bjj.cmd missing: run 04-install-analysis.ps1' }
    if (Test-Path $a.hypecut.exe) {
        $v = ((Invoke-Native -File $a.hypecut.exe -Arguments @('--version')) -join ' ').Trim()
        Add-Row 'HypeCut' 'verified' "$v (CPU, local; EDL + JSON output)"
    } else { Add-Row 'HypeCut' 'skipped' 'not installed' }
    Add-Row 'GPU extras (torch/ultralytics/whisper)' $(if ($a.bjj_pipeline.gpu_extras) {'installed'} else {'skipped'}) 'opt-in via 04-install-analysis.ps1 -WithGpuExtras'
} else { Add-Row 'Analysis layer' 'skipped' 'run 04-install-analysis.ps1' }
Add-Row 'LumenSport / auto-highlight / Sports-Highlight-Detector' 'unsupported' 'evaluated; cloud upload / non-functional / not BJJ (docs/REPORT.md)'
Add-Row 'video-ad-editor' 'skipped' 'evaluated; adapter available (bjj adapters vae-plan)'

# --- Resolve bridge (direct scripting API) live check
if (Test-Path (Join-Path $root 'bin\bjj.cmd')) {
    $st = (Invoke-Native -File (Join-Path $root 'bin\bjj.cmd') -Arguments @('resolve', 'status')) -join "`n"
    if ($st -match '"connected":\s*true') { Add-Row 'Resolve scripting bridge' 'verified' 'connected to running Resolve' }
    else { Add-Row 'Resolve scripting bridge' 'requires-manual-setup' 'not connected (Resolve Studio running + External scripting = Local)' }
}

# --- commercial plugins
$ofx = Join-Path $env:ProgramFiles 'Common Files\OFX\Plugins'
$cl = @(Get-ChildItem $ofx -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Colourlab|ColorIntelligence' })
Add-Row 'Colourlab Ai (OFX)' $(if ($cl) {'installed'} else {'requires-manual-setup'}) $(if ($cl) { $cl.FullName -join '; ' } else { 'not found in Common Files\OFX\Plugins; see docs/COMMERCIAL-PLUGINS.md' })
$vst = @(Get-ChildItem (Join-Path $env:ProgramFiles 'Common Files\VST3') -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'CrumplePop|AudioDenoise|WindRemover|EchoRemover|RustleRemover|PopRemover|Levelmatic|VoiceGate|Traffic' })
Add-Row 'CrumplePop (Boris FX, VST3)' $(if ($vst) {'installed'} else {'requires-manual-setup'}) $(if ($vst) { ($vst.Name | Select-Object -Unique) -join ', ' } else { 'no CrumplePop VST3 found; see docs/COMMERCIAL-PLUGINS.md' })

# --- write
$out = Join-Path $root 'inventory'
New-DirectorySafe $out | Out-Null
@{ generated = (Get-Date).ToString('s'); rows = $rows } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'verify-latest.json') -Encoding UTF8
$md = @('# Verification status', '', '| component | status | detail |', '|---|---|---|')
foreach ($r in $rows) { $md += "| $($r.component) | $($r.status) | $(($r.detail -replace '\|', '/') -replace "`r?`n", ' ') |" }
$md -join "`n" | Set-Content (Join-Path $out 'verify-latest.md') -Encoding UTF8
Write-Host ($md -join "`n")
Write-Log "verification written to $out\verify-latest.md" 'OK'
exit 0
