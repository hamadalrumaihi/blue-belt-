<#
.SYNOPSIS
  Install the DaVinci Resolve MCP servers into isolated environments and register ONE primary with Claude Code.

.DESCRIPTION
  Layout (all under C:\AI-Video-Tools\mcp\):
    davinci-resolve-mcp-gursky\     PRIMARY   samuelgursky/davinci-resolve-mcp   (compound mode, 37 tools)
    davinci-resolve-mcp-cipriano\   ALTERNATE CiprianSpiridon/davinci-resolve-mcp (334 tools, ships 4 skills)
    resolve-mcp-server-guycochran\  ALTERNATE guycochran/resolve-mcp-server      (77 tools, Studio 21)
    Davinci-MCP-iamkewl\            REFERENCE Iamkewl/Davinci-MCP                (24 tools, never hardware-tested)

  Each gets its own uv-managed venv (Python 3.12 by default: the lowest-risk range for Resolve
  scripting). Only the primary is registered with Claude Code (user scope, name "davinci-resolve").
  Use switch-mcp.ps1 to swap. Upstream repositories are cloned read-only; nothing in them is patched.

  Safety: config backup is taken first (01-backup-config.ps1), an existing "davinci-resolve" MCP
  registration is never replaced without -ReplaceExisting, Resolve Studio restrictions are reported
  and never bypassed, update checks of the primary are disabled (DAVINCI_RESOLVE_MCP_UPDATE_CHECK=0).

.PARAMETER Primary   gursky (default) | cipriano | guycochran
.PARAMETER SkipAlternates  Only install the primary.
.PARAMETER ReplaceExisting Replace an existing user-scope "davinci-resolve" MCP registration.
.PARAMETER ResolveBridge   auto (default: install on the Free edition) | yes | no.
    The samuelgursky server ships an in-app bridge for the FREE edition: a small script that runs
    from Resolve's own Workspace > Scripts menu (not gated through 21.0.x) and re-exports the live
    scripting object over an authenticated loopback listener. The server picks it up automatically
    whenever external scripting refuses. This uses Resolve's supported internal scripting; it does
    not bypass licensing. Resolve 21.1+ Free removed Python from the Scripts menu entirely.
#>
[CmdletBinding()]
param(
    [ValidateSet('gursky','cipriano','guycochran')][string]$Primary = 'gursky',
    [switch]$SkipAlternates,
    [switch]$ReplaceExisting,
    [switch]$SkipIamkewl,
    [string]$PythonVersion = '3.12',
    [ValidateSet('auto','yes','no')][string]$ResolveBridge = 'auto'
)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Stop'
$root = Get-ToolsRoot
$mcpRoot = New-DirectorySafe (Join-Path $root 'mcp')
Write-Log "MCP install -> $mcpRoot (primary: $Primary)" 'STEP'

# ---------------------------------------------------------------- prerequisites
if (-not (Get-CommandPath 'git')) { throw 'git not found. Install with: winget install --id Git.Git -e' }
$uv = Get-CommandPath 'uv'
if (-not $uv) {
    Write-Log 'uv not found; installing per-user via winget (astral-sh.uv)' 'WARN'
    if (Get-CommandPath 'winget') { Invoke-Native -File 'winget' -Arguments @('install', '--id', 'astral-sh.uv', '-e', '--accept-source-agreements', '--accept-package-agreements') | Out-Null }
    $env:PATH = "$env:USERPROFILE\.local\bin;$env:PATH"
    $uv = Get-CommandPath 'uv'
    if (-not $uv) { throw 'uv still not found after install. Open a new terminal or install from https://docs.astral.sh/uv/' }
}
& (Join-Path $PSScriptRoot '01-backup-config.ps1') | Out-Null

$resolve = Get-ResolveInstall
if (-not $resolve.installed) { Write-Log 'DaVinci Resolve not detected. Servers will be installed but cannot connect until Resolve is installed.' 'WARN' }
elseif ($resolve.edition -eq 'Free') {
    Write-Log 'Resolve FREE edition: Blackmagic restricts external scripting to Studio. The MCP servers will install but every live tool will refuse to connect. This is a licence restriction and is not bypassed.' 'WARN'
}
$apiDir = if ($resolve.script_api) { $resolve.script_api } else { Join-Path $env:ProgramData 'Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting' }
$libPath = if ($resolve.script_lib) { $resolve.script_lib } else { Join-Path $env:ProgramFiles 'Blackmagic Design\DaVinci Resolve\fusionscript.dll' }
$modulesDir = Join-Path $apiDir 'Modules'

# ---------------------------------------------------------------- helpers
function Install-Repo {
    param([string]$Url, [string]$Dir, [string]$Ref = $null)
    if (Test-Path -LiteralPath (Join-Path $Dir '.git')) {
        Write-Log "repo exists, fetching updates (no reset): $Dir"
        try { Invoke-Checked -File 'git' -Arguments @('-C', $Dir, 'fetch', '--quiet', 'origin') } catch { Write-Log "fetch failed ($_); keeping local copy" 'WARN' }
        try { Invoke-Checked -File 'git' -Arguments @('-C', $Dir, 'pull', '--ff-only', '--quiet') } catch { Write-Log "pull --ff-only skipped ($_)" 'WARN' }
    } else {
        Invoke-Checked -File 'git' -Arguments @('clone', '--depth', '1', $Url, $Dir)
    }
    if ($Ref) { Invoke-Checked -File 'git' -Arguments @('-C', $Dir, 'checkout', '--quiet', $Ref) }
    return (Get-Item -LiteralPath $Dir).FullName
}

function New-Venv {
    param([string]$Dir)
    $venv = Join-Path $Dir '.venv'
    if (-not (Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))) {
        Invoke-Checked -File $uv -Arguments @('venv', $venv, '--python', $PythonVersion, '--quiet')
    }
    return (Join-Path $venv 'Scripts\python.exe')
}

function Write-ServerEnvFile {
    param([string]$Dir, [hashtable]$Vars)
    $lines = $Vars.Keys | ForEach-Object { "$_=$($Vars[$_])" }
    $lines | Set-Content -LiteralPath (Join-Path $Dir 'bbm-server.env') -Encoding UTF8
}

$registry = @{}

# ---------------------------------------------------------------- 1. samuelgursky (primary by default)
$gDir = Join-Path $mcpRoot 'davinci-resolve-mcp-gursky'
if ($Primary -eq 'gursky' -or -not $SkipAlternates) {
    Write-Log 'Installing samuelgursky/davinci-resolve-mcp (Python compound server)' 'STEP'
    $gDir = Install-Repo 'https://github.com/samuelgursky/davinci-resolve-mcp' $gDir
    $gPy = New-Venv $gDir
    # requirements.txt pins mcp[cli]<2 (the 2.x SDK removed mcp.server.fastmcp). Do NOT run the
    # upstream install.py: it writes a project .mcp.json, runs network update checks and npm.
    Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $gPy, '--quiet', '-r', (Join-Path $gDir 'requirements.txt'))
    $gEnv = @{ RESOLVE_SCRIPT_API = $apiDir; RESOLVE_SCRIPT_LIB = $libPath; PYTHONPATH = $modulesDir
               PYTHONIOENCODING = 'utf-8'; DAVINCI_RESOLVE_MCP_UPDATE_CHECK = '0' }
    Write-ServerEnvFile $gDir $gEnv
    $registry['gursky'] = @{ dir = $gDir; python = $gPy; command = $gPy; args = @((Join-Path $gDir 'src\server.py')); env = $gEnv
                             tools = '37 compound (use --full for 389 granular)'; upstream = 'https://github.com/samuelgursky/davinci-resolve-mcp' }
    # import smoke test (no Resolve needed)
    Invoke-Native -File $gPy -Arguments @('-c', "import mcp, mcp.server.fastmcp; print('mcp ok')") | ForEach-Object { Write-Log "  $_" }
    if ((Get-LastNativeExitCode) -eq 0) { Write-Log 'gursky: python deps import OK' 'OK' } else { Write-Log 'gursky: import check failed (see lines above)' 'ERROR' }

    # --- Free-edition in-app bridge (see .PARAMETER ResolveBridge)
    $wantBridge = ($ResolveBridge -eq 'yes') -or ($ResolveBridge -eq 'auto' -and $resolve.installed -and $resolve.edition -eq 'Free')
    $bridgeScript = Join-Path $gDir 'scripts\install_resolve_bridge.py'
    if ($wantBridge -and (Test-Path -LiteralPath $bridgeScript)) {
        $major = 0; try { $major = [int](([string]$resolve.version).Split('.')[0]) } catch { }
        if ($major -ge 21 -and ([string]$resolve.version) -notmatch '^21\.0\.') {
            Write-Log "Resolve $($resolve.version) Free: Blackmagic removed Python from the Scripts menu in 21.1+, so the in-app bridge cannot work. MCP control needs Resolve Studio." 'WARN'
        } else {
            Write-Log 'Resolve FREE edition: installing the in-app bridge script into Resolve''s per-user Scripts\Utility folder' 'STEP'
            $bridgeOut = @(Invoke-Native -File $gPy -Arguments @($bridgeScript) -WorkingDirectory $gDir)
            $bridgeOut | ForEach-Object { Write-Log "  $_" }
            if ((Get-LastNativeExitCode) -eq 0) {
                Write-Log 'Bridge installed. In Resolve: restart it, open a project, then Workspace > Scripts > resolve_bridge (leave Resolve open). The MCP server then connects automatically.' 'OK'
                Write-Log 'Resolve must see a Python 3 (python.org 3.x installed for this user is enough). If "resolve_bridge" is missing from the Scripts menu, see docs\MANUAL-STEPS.md "Free edition".' 'INFO'
            } else {
                Write-Log 'Bridge installer reported a problem (lines above). The rest of the install continues; the EDL workflow does not need it.' 'WARN'
            }
        }
    } elseif ($wantBridge) {
        Write-Log "bridge installer not found at $bridgeScript (upstream layout changed?)" 'WARN'
    }
}

# ---------------------------------------------------------------- 2. CiprianSpiridon (alternate, ships the 4 skills)
$cDir = Join-Path $mcpRoot 'davinci-resolve-mcp-cipriano'
if ($Primary -eq 'cipriano' -or -not $SkipAlternates) {
    Write-Log 'Installing CiprianSpiridon/davinci-resolve-mcp (334 tools + skills)' 'STEP'
    $cDir = Install-Repo 'https://github.com/CiprianSpiridon/davinci-resolve-mcp' $cDir
    $cPy = New-Venv $cDir
    # Editable install of the package only. Optional extras (transcription=openai-whisper,
    # screenshot=mss+pillow) are NOT installed here; see 04-install-analysis.ps1 -WithWhisper.
    Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $cPy, '--quiet', '-e', $cDir)
    # Upstream declares mcp[cli]>=1.3.0 unpinned; the 2.x SDK removed mcp.server.fastmcp, which this
    # server imports, so pin back to the 1.x line (same constraint samuelgursky uses).
    Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $cPy, '--quiet', 'mcp[cli]>=1.3,<2')
    # pyautogui is required by the live transition keystroke tool but undeclared upstream.
    Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $cPy, '--quiet', 'pyautogui', 'mss', 'pillow')
    $cExe = Join-Path $cDir '.venv\Scripts\davinci-resolve-mcp.exe'
    $cEnv = @{ RESOLVE_SCRIPT_API = $apiDir; RESOLVE_SCRIPT_LIB = $libPath; PYTHONIOENCODING = 'utf-8' }
    Write-ServerEnvFile $cDir $cEnv
    $registry['cipriano'] = @{ dir = $cDir; python = $cPy; command = $cExe; args = @(); env = $cEnv
                               tools = '334 (316 live + 18 offline)'; upstream = 'https://github.com/CiprianSpiridon/davinci-resolve-mcp' }
    try {
        Invoke-Native -File $cPy -Arguments @('-c', "import davinci_resolve_mcp.server; print('ok')") | ForEach-Object { Write-Log "  $_" }
        if (Test-Path -LiteralPath (Join-Path $cDir 'tests\test_tool_exposure.py')) {
            Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $cPy, '--quiet', 'pytest')
            Invoke-Checked -File $cPy -Arguments @('-m', 'pytest', '-q', '-p', 'no:cacheprovider', 'tests\test_tool_exposure.py') -WorkingDirectory $cDir
            Write-Log 'cipriano: offline tool-exposure test passed' 'OK'
        }
    } catch { Write-Log "cipriano: smoke test failed: $_" 'WARN' }
}

# ---------------------------------------------------------------- 3. guycochran (alternate)
$qDir = Join-Path $mcpRoot 'resolve-mcp-server-guycochran'
if ($Primary -eq 'guycochran' -or -not $SkipAlternates) {
    Write-Log 'Installing guycochran/resolve-mcp-server (77 tools, Studio 21)' 'STEP'
    $qDir = Install-Repo 'https://github.com/guycochran/resolve-mcp-server' $qDir
    $qPy = New-Venv $qDir
    Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $qPy, '--quiet', '-e', $qDir)
    $qEnv = @{ RESOLVE_SCRIPT_API = $apiDir; RESOLVE_SCRIPT_LIB = $libPath; PYTHONPATH_RESOLVE = $modulesDir; TRANSPORT = 'stdio'; PYTHONIOENCODING = 'utf-8' }
    Write-ServerEnvFile $qDir $qEnv
    $registry['guycochran'] = @{ dir = $qDir; python = $qPy; command = $qPy; args = @('-m', 'resolve_mcp'); env = $qEnv
                                 tools = '77 + 16 resources + 5 prompts'; upstream = 'https://github.com/guycochran/resolve-mcp-server' }
    Invoke-Native -File $qPy -Arguments @('-m', 'resolve_mcp', '--doctor') | Select-Object -First 15 | ForEach-Object { Write-Log "  $_" }
}

# ---------------------------------------------------------------- 4. Iamkewl (reference only, never registered)
if (-not $SkipAlternates -and -not $SkipIamkewl) {
    Write-Log 'Cloning Iamkewl/Davinci-MCP as reference (uv workspace, Python >=3.11; not hardware-tested upstream)' 'STEP'
    $iDir = Install-Repo 'https://github.com/Iamkewl/Davinci-MCP' (Join-Path $mcpRoot 'Davinci-MCP-iamkewl')
    try {
        Invoke-Checked -File $uv -Arguments @('sync', '--quiet', '--package', 'resolve-mcp') -WorkingDirectory $iDir
        $registry['iamkewl'] = @{ dir = $iDir; command = $uv; args = @('run', '--project', $iDir, 'resolve-mcp', '--backend', 'davinci'); env = @{ RESOLVE_SCRIPT_API = $apiDir; RESOLVE_SCRIPT_LIB = $libPath; PYTHONPATH = $modulesDir }
                                  tools = '24 live'; upstream = 'https://github.com/Iamkewl/Davinci-MCP' }
    } catch { Write-Log "iamkewl uv sync failed (non-fatal): $_" 'WARN' }
}

# ---------------------------------------------------------------- registry file (used by switch-mcp.ps1, launcher, /resolve-health)
$regPath = Join-Path $mcpRoot 'servers.json'
@{ updated = (Get-Date).ToString('s'); primary = $Primary; servers = $registry; resolve = $resolve } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $regPath -Encoding UTF8
Write-Log "server registry -> $regPath" 'OK'

# ---------------------------------------------------------------- register the primary with Claude Code (user scope)
if (-not (Test-ClaudeCli)) {
    Write-Log 'claude CLI not found: skipping registration. Run switch-mcp.ps1 after installing Claude Code.' 'WARN'
    exit 0
}
& (Join-Path $PSScriptRoot 'switch-mcp.ps1') -To $Primary -ReplaceExisting:$ReplaceExisting
exit $LASTEXITCODE
