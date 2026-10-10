<#
.SYNOPSIS
  Make ONE installed DaVinci Resolve MCP server the active "davinci-resolve" server in Claude Code (user scope).

.DESCRIPTION
  Reads C:\AI-Video-Tools\mcp\servers.json (written by 02-install-mcp.ps1), removes the current
  user-scope "davinci-resolve" registration (after backing up ~/.claude.json) and registers the chosen
  one. Never registers two Resolve-control servers at once.

.EXAMPLE
  .\switch-mcp.ps1 -To gursky
  .\switch-mcp.ps1 -To cipriano      # needed before using the davinci-resolve* skills
  .\switch-mcp.ps1 -Status
#>
[CmdletBinding()]
param(
    [ValidateSet('gursky','cipriano','guycochran','iamkewl')][string]$To,
    [switch]$Status,
    [switch]$ReplaceExisting,
    [string]$Name = 'davinci-resolve'
)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Stop'
$regPath = Join-Path (Get-ToolsRoot) 'mcp\servers.json'
if (-not (Test-Path -LiteralPath $regPath)) { throw "servers.json not found; run 02-install-mcp.ps1 first ($regPath)" }
$reg = Get-Content -LiteralPath $regPath -Raw | ConvertFrom-Json

if ($Status -or -not $To) {
    $current = Get-ClaudeMcpServers
    Write-Host "Installed servers:" -ForegroundColor Cyan
    foreach ($k in $reg.servers.PSObject.Properties.Name) { Write-Host ("  {0,-11} {1}" -f $k, $reg.servers.$k.dir) }
    Write-Host "Active in Claude Code (user scope):" -ForegroundColor Cyan
    if ($current.ContainsKey($Name)) {
        $c = $current[$Name]
        Write-Host "  $Name -> $($c.command) $($c.args -join ' ')"
    } else { Write-Host "  (none named $Name)" }
    if (Test-ClaudeCli) { Invoke-Native -File (Get-ClaudeCliPath) -Arguments @('mcp', 'list') | ForEach-Object { Write-Host "  $_" } }
    exit 0
}

if (-not (Test-ClaudeCli)) { throw 'claude CLI not found on PATH' }
$claude = Get-ClaudeCliPath
$srv = $reg.servers.$To
if (-not $srv) { throw "server '$To' is not installed (run 02-install-mcp.ps1)" }

$existing = Get-ClaudeMcpServers
if ($existing.ContainsKey($Name)) {
    $cur = $existing[$Name]
    $ours = $reg.servers.PSObject.Properties.Value | Where-Object { $_.command -eq $cur.command } | Select-Object -First 1
    if (-not $ours -and -not $ReplaceExisting) {
        Write-Log "A user-scope MCP server named '$Name' already exists and was not created by this installer ($($cur.command)). Re-run with -ReplaceExisting to replace it (a backup is taken first)." 'WARN'
        exit 2
    }
    & (Join-Path $PSScriptRoot '01-backup-config.ps1') | Out-Null
    Write-Log "removing current '$Name' registration"
    Invoke-Native -File $claude -Arguments @('mcp', 'remove', $Name, '--scope', 'user') | ForEach-Object { Write-Log "  $_" }
}

$cliArgs = @('mcp', 'add', '--transport', 'stdio', '--scope', 'user')
foreach ($k in $srv.env.PSObject.Properties.Name) { $cliArgs += @('-e', "$k=$($srv.env.$k)") }
$cliArgs += @($Name, '--', $srv.command)
$srvArgs = @(Get-Prop $srv 'args' @())
if ($srvArgs.Count) { $cliArgs += $srvArgs }
Write-Log ("claude " + ($cliArgs -join ' ')) 'STEP'
Invoke-Native -File $claude -Arguments $cliArgs | ForEach-Object { Write-Log "  $_" }
$code = Get-LastNativeExitCode
if ($code -ne 0) { throw "claude mcp add failed (exit $code)" }

$reg.primary = $To
$reg | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $regPath -Encoding UTF8
Write-Log "active server: $To ($($srv.tools))" 'OK'
Write-Log 'Verifying connection (needs Resolve Studio running with External scripting = Local for a green check):'
Invoke-Native -File $claude -Arguments @('mcp', 'get', $Name) | ForEach-Object { Write-Log "  $_" }
exit 0
