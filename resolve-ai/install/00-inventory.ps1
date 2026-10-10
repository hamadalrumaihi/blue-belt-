<#
.SYNOPSIS
  Inspect this Windows PC before anything is installed. Read-only.

.DESCRIPTION
  Detects DaVinci Resolve (version, edition, scripting files), Python / Git / Node / npm /
  FFmpeg / uv, NVIDIA driver + CUDA, Claude Code (MCP servers, skills, commands, agents,
  plugins), existing video/AI projects, disk space, and likely conflicts.
  Writes C:\AI-Video-Tools\inventory\inventory-<date>.json and .md (or -OutDir).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\00-inventory.ps1
#>
[CmdletBinding()]
param(
    [string]$OutDir = $null,
    [string[]]$ProjectSearchRoots = @("$env:USERPROFILE\Documents", "$env:USERPROFILE\Videos", "$env:USERPROFILE\source", "$env:USERPROFILE\Desktop", 'C:\AI-Video-Tools', 'D:\', 'E:\')
)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Continue'
if (-not $OutDir) { $OutDir = Join-Path (Get-ToolsRoot) 'inventory' }
New-DirectorySafe $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Write-Log "System inventory starting (read-only)" 'STEP'

$inv = [ordered]@{
    generated = (Get-Date).ToString('s')
    computer  = [ordered]@{
        name = $env:COMPUTERNAME
        os = (Get-CimInstance Win32_OperatingSystem).Caption
        os_version = (Get-CimInstance Win32_OperatingSystem).Version
        cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
        ram_gb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
        powershell = $PSVersionTable.PSVersion.ToString()
    }
    resolve = Get-ResolveInstall
    resolve_running = Test-ResolveRunning
    gpu = Get-NvidiaInfo
    tools = [ordered]@{}
    python = @(Get-PythonCandidates)
    claude = [ordered]@{}
    projects = @()
    disks = @()
    conflicts = @()
    notes = @()
}

# --- tools
foreach ($t in @(
    @{n='git'; a=@('--version')}, @{n='node'; a=@('--version')}, @{n='npm'; a=@('--version')}, @{n='npx'; a=@('--version')},
    @{n='ffmpeg'; a=@('-version')}, @{n='ffprobe'; a=@('-version')}, @{n='uv'; a=@('--version')}, @{n='uvx'; a=@('--version')},
    @{n='claude'; a=@('--version')}, @{n='py'; a=@('--version')}, @{n='winget'; a=@('--version')}, @{n='pwsh'; a=@('--version')},
    @{n='nvcc'; a=@('--version')}, @{n='hypecut'; a=@('--version')}
)) {
    $path = Get-CommandPath $t.n
    $inv.tools[$t.n] = [ordered]@{ path = $path; version = $(if ($path) { Get-CommandVersion -Name $t.n -Arguments $t.a } else { $null }) }
}

# --- a WORKING ffmpeg (the first on PATH can be a broken npm stub)
$ff = Find-Ffmpeg
$inv.tools['ffmpeg_working'] = [ordered]@{ path = $(if ($ff) { $ff.ffmpeg } else { $null }); version = $(if ($ff) { Get-CommandVersion -Name $ff.ffmpeg -Arguments @('-version') } else { $null }) }
$inv.tools['ffprobe_working'] = [ordered]@{ path = $(if ($ff) { $ff.ffprobe } else { $null }); version = $(if ($ff) { Get-CommandVersion -Name $ff.ffprobe -Arguments @('-version') } else { $null }) }
$claudeExe = Get-ClaudeCliPath
$inv.tools['claude'] = [ordered]@{ path = $claudeExe; version = $(if ($claudeExe) { Get-CommandVersion -Name $claudeExe } else { $null }) }

# --- CUDA toolkit / cuDNN (optional; PyTorch wheels bundle their own CUDA runtime)
$cudaDirs = @()
$cudaRoot = Join-Path $env:ProgramFiles 'NVIDIA GPU Computing Toolkit\CUDA'
if (Test-Path $cudaRoot) { $cudaDirs = Get-ChildItem $cudaRoot -Directory | Select-Object -ExpandProperty Name }
$inv.gpu['cuda_toolkits_installed'] = $cudaDirs
$inv.gpu['cuda_path_env'] = $env:CUDA_PATH

# --- Claude Code configuration
$cp = Get-ClaudeConfigPaths
$inv.claude.paths = $cp
$inv.claude.cli_installed = Test-ClaudeCli
$inv.claude.user_mcp_servers = @((Get-ClaudeMcpServers).Keys)
foreach ($pair in @(@{k='skills'; d=$cp.user_skills_dir}, @{k='commands'; d=$cp.user_commands_dir}, @{k='agents'; d=$cp.user_agents_dir})) {
    $inv.claude[$pair.k] = @()
    if (Test-Path -LiteralPath $pair.d) {
        $inv.claude[$pair.k] = @(Get-ChildItem -LiteralPath $pair.d -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    }
}
$inv.claude.plugins = @()
if (Test-Path -LiteralPath $cp.user_plugins_dir) {
    $inv.claude.plugins = @(Get-ChildItem -LiteralPath $cp.user_plugins_dir -Recurse -Depth 2 -Filter 'plugin.json' -ErrorAction SilentlyContinue | ForEach-Object { $_.Directory.Parent.Name + '\' + $_.Directory.Name })
}
if (Test-Path -LiteralPath $cp.user_settings) {
    try { $s = Get-Content -LiteralPath $cp.user_settings -Raw | ConvertFrom-Json; $inv.claude.settings_keys = @($s.PSObject.Properties.Name) } catch { $inv.claude.settings_keys = @('unreadable') }
}
$inv.claude.desktop_config_exists = Test-Path -LiteralPath $cp.claude_desktop_cfg
if ($inv.claude.cli_installed) {
    $inv.claude.cli_path = Get-ClaudeCliPath
    $inv.claude.mcp_list = ((Invoke-Native -File (Get-ClaudeCliPath) -Arguments @('mcp', 'list')) -join "`n").Trim()
}

# --- existing video / AI projects (shallow, name-based, read-only)
$patterns = 'resolve','davinci','mcp','hypecut','highlight','video','edit','whisper','yolo','ultralytics','comfy','stable','llama','ollama','venv','.venv'
foreach ($root in $ProjectSearchRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    try {
        Get-ChildItem -LiteralPath $root -Directory -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
            $n = $_.Name.ToLower()
            if ($patterns | Where-Object { $n -like "*$_*" }) {
                $kind = @()
                if (Test-Path (Join-Path $_.FullName '.git')) { $kind += 'git' }
                if (Test-Path (Join-Path $_.FullName 'pyproject.toml')) { $kind += 'python' }
                if (Test-Path (Join-Path $_.FullName 'package.json')) { $kind += 'node' }
                if (Test-Path (Join-Path $_.FullName 'pyvenv.cfg')) { $kind += 'venv' }
                $inv.projects += [ordered]@{ path = $_.FullName; kind = ($kind -join ',') }
            }
        }
    } catch { }
}

# --- disks
$inv.disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [ordered]@{ drive = $_.DeviceID; free_gb = [math]::Round($_.FreeSpace / 1GB, 1); size_gb = [math]::Round($_.Size / 1GB, 1) } })

# --- conflicts and notes
$r = $inv.resolve
if (-not $r.installed) { $inv.conflicts += 'DaVinci Resolve not detected: install it from blackmagicdesign.com/products/davinciresolve before the MCP step.' }
elseif ($r.edition -eq 'Free') { $inv.conflicts += 'Resolve FREE edition detected: external scripting (and therefore every MCP server) is a Studio-only feature. The pipeline still produces EDLs you can import manually.' }
if ($r.installed -and -not $r.script_lib) { $inv.conflicts += "fusionscript.dll not found under $($r.install_dir); scripting API unavailable." }
if ($r.python_module_uses_imp -eq $true) { $inv.notes += 'DaVinciResolveScript.py uses the removed `imp` module: use Python 3.10-3.11 for the Resolve venv (3.12+ needs the fusionscript fallback loader).' }
$pyForResolve = Select-PythonForResolve
if (-not $pyForResolve) { $inv.conflicts += 'No Python found. Install Python 3.12 (x64) from python.org with "py launcher" and "Add to PATH".' }
elseif ([version]$pyForResolve.version -ge [version]'3.13') { $inv.notes += "Only Python $($pyForResolve.version) found; 3.10-3.12 is the lowest-risk range for Resolve scripting. uv can download 3.12 for the venvs." }
if (-not $ff) { $inv.notes += 'No WORKING FFmpeg found (a broken stub may sit on PATH): 04-install-analysis.ps1 installs Gyan.FFmpeg via winget and pins the pipeline to it.' }
elseif ($inv.tools.ffmpeg.path -and $inv.tools.ffmpeg.path -ne $ff.ffmpeg) { $inv.notes += "The first ffmpeg on PATH ($($inv.tools.ffmpeg.path)) does not run; the pipeline will use $($ff.ffmpeg) instead." }
if (-not $inv.tools.git.path) { $inv.conflicts += 'Git not found: required to clone the MCP servers (winget install Git.Git).' }
if (-not $inv.tools.uv.path) { $inv.notes += 'uv not found: the installer will install it per-user (winget install astral-sh.uv) to create isolated venvs.' }
if (-not $inv.claude.cli_installed) { $inv.conflicts += 'Claude Code CLI not found (PATH, %USERPROFILE%\.local\bin, %APPDATA%\npm): MCP registration and skill verification need it. Install: https://code.claude.com/docs/en/setup (or `npm install -g @anthropic-ai/claude-code`), then re-run.' }
if ($inv.claude.user_mcp_servers -contains 'davinci-resolve') { $inv.notes += 'A user-scope MCP server named davinci-resolve already exists; the installer will back it up and ask before replacing it.' }
if ($inv.gpu.vram_mb -and $inv.gpu.vram_mb -lt 10000) { $inv.notes += "GPU VRAM $($inv.gpu.vram_mb) MB: fine for HypeCut (CPU) and YOLO-pose/whisper-small; avoid running Resolve renders and GPU inference at the same time." }
$sysDrive = $inv.disks | Where-Object { $_.drive -eq $env:SystemDrive }
if ($sysDrive -and $sysDrive.free_gb -lt 15) { $inv.conflicts += "Only $($sysDrive.free_gb) GB free on $($env:SystemDrive): installs need ~6 GB (CUDA torch optional +3 GB)." }

# --- write
$json = Join-Path $OutDir "inventory-$stamp.json"
$inv | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $json -Encoding UTF8
Copy-Item -LiteralPath $json -Destination (Join-Path $OutDir 'inventory-latest.json') -Force

$md = @()
$md += "# System inventory ($($inv.generated))"
$md += ''
$md += "| item | value |"; $md += "|---|---|"
$md += "| OS | $($inv.computer.os) $($inv.computer.os_version) |"
$md += "| CPU / RAM | $($inv.computer.cpu) / $($inv.computer.ram_gb) GB |"
$md += "| GPU | $($inv.gpu.name) (driver $($inv.gpu.driver), VRAM $($inv.gpu.vram_mb) MB, CUDA $($inv.gpu.cuda_version)) |"
$md += "| DaVinci Resolve | installed=$($r.installed) edition=$($r.edition) version=$($r.version) running=$($inv.resolve_running) |"
$md += "| Resolve scripting | api=$($r.script_api) lib=$($r.script_lib) modules_ok=$($r.script_modules_ok) |"
foreach ($k in $inv.tools.Keys) { $md += "| $k | $($inv.tools[$k].version) ($($inv.tools[$k].path)) |" }
$md += "| Python interpreters | $(($inv.python | ForEach-Object { "$($_.version) $($_.path)" }) -join '; ') |"
$md += "| Claude CLI | $($inv.claude.cli_installed) |"
$md += "| Claude user MCP servers | $($inv.claude.user_mcp_servers -join ', ') |"
$md += "| Claude user skills | $($inv.claude.skills -join ', ') |"
$md += "| Claude user commands | $($inv.claude.commands -join ', ') |"
$md += "| Claude plugins | $($inv.claude.plugins -join ', ') |"
$md += "| Disks | $(($inv.disks | ForEach-Object { "$($_.drive) $($_.free_gb)/$($_.size_gb) GB free" }) -join '; ') |"
$md += ''
$md += '## Existing video / AI projects'; $md += ''
if ($inv.projects.Count) { foreach ($p in $inv.projects) { $md += "- $($p.path) [$($p.kind)]" } } else { $md += '- none found in the searched roots' }
$md += ''; $md += '## Conflicts (must fix before installing)'; $md += ''
if ($inv.conflicts.Count) { foreach ($c in $inv.conflicts) { $md += "- $c" } } else { $md += '- none' }
$md += ''; $md += '## Notes'; $md += ''
foreach ($n in $inv.notes) { $md += "- $n" }
$mdPath = Join-Path $OutDir "inventory-$stamp.md"
$md -join "`n" | Set-Content -LiteralPath $mdPath -Encoding UTF8
Copy-Item -LiteralPath $mdPath -Destination (Join-Path $OutDir 'inventory-latest.md') -Force

Write-Host ''
Write-Host ($md -join "`n")
Write-Log "Inventory written: $json" 'OK'
if ($inv.conflicts.Count) { Write-Log "$($inv.conflicts.Count) conflict(s) found - review before running install-all.ps1" 'WARN' }
exit 0
