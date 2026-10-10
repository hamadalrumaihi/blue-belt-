# Shared helpers for the Blue Belt Media Resolve-AI installers (Windows PowerShell 5.1+ / pwsh 7).
# Everything here is read-only except Write-Log / New-DirectorySafe.

Set-StrictMode -Version Latest

$script:ToolsRoot = if ($env:AI_VIDEO_TOOLS) { $env:AI_VIDEO_TOOLS } else { 'C:\AI-Video-Tools' }
$script:LogDir    = Join-Path $script:ToolsRoot 'logs'

function Get-ToolsRoot { $script:ToolsRoot }
function Get-LogDir    { $script:LogDir }

function New-DirectorySafe {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
    return $Path
}

function Write-Log {
    param([string]$Message, [ValidateSet('INFO','WARN','ERROR','OK','STEP')][string]$Level = 'INFO')
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "$stamp [$Level] $Message"
    $color = switch ($Level) { 'WARN' {'Yellow'} 'ERROR' {'Red'} 'OK' {'Green'} 'STEP' {'Cyan'} default {'Gray'} }
    Write-Host $line -ForegroundColor $color
    try {
        New-DirectorySafe $script:LogDir | Out-Null
        Add-Content -LiteralPath (Join-Path $script:LogDir ("install-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))) -Value $line -Encoding UTF8
    } catch { }
}

function Get-CommandPath {
    param([Parameter(Mandatory)][string]$Name)
    $c = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    return $null
}

function Get-CommandVersion {
    param([Parameter(Mandatory)][string]$Name, [string[]]$Args = @('--version'))
    $p = Get-CommandPath $Name
    if (-not $p) { return $null }
    try {
        $out = & $p @Args 2>&1 | Select-Object -First 1
        return ($out | Out-String).Trim()
    } catch { return $null }
}

function Invoke-Checked {
    # Run an external command, stream its output to the console + log, throw on non-zero exit.
    param([Parameter(Mandatory)][string]$File, [string[]]$Arguments = @(), [string]$WorkingDirectory = $null, [hashtable]$Env = @{})
    $old = @{}
    foreach ($k in $Env.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $Env[$k]) }
    try {
        Write-Log ("> {0} {1}" -f $File, ($Arguments -join ' '))
        $prev = Get-Location
        if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
        try {
            & $File @Arguments 2>&1 | ForEach-Object { Write-Host "    $_" }
            if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE from $File" }
        } finally { Set-Location $prev }
    } finally {
        foreach ($k in $old.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k]) }
    }
}

function Get-ResolveInstall {
    <#
    Detect DaVinci Resolve from the Uninstall registry (works for Free + Studio, no admin needed)
    and from the default install folder. Edition comes from DisplayName.
    #>
    $result = [ordered]@{
        installed = $false; edition = 'unknown'; version = $null; install_dir = $null; exe = $null
        script_api = $null; script_lib = $null; script_modules_ok = $false; python_module_uses_imp = $null
        fusion_scripts_dir = $null; preferences_dir = $null
    }
    $keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
              'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
              'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
    $entry = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
             Where-Object { $_.DisplayName -like 'DaVinci Resolve*' } | Select-Object -First 1
    $dir = Join-Path $env:ProgramFiles 'Blackmagic Design\DaVinci Resolve'
    if ($entry) {
        $result.installed = $true
        $result.version = $entry.DisplayVersion
        $result.edition = if ($entry.DisplayName -match 'Studio') { 'Studio' } else { 'Free' }
        if ($entry.InstallLocation) { $dir = $entry.InstallLocation.TrimEnd('\') }
    }
    $exe = Join-Path $dir 'Resolve.exe'
    if (Test-Path -LiteralPath $exe) {
        $result.installed = $true
        $result.install_dir = $dir
        $result.exe = $exe
        if (-not $result.version) {
            try { $result.version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion } catch { }
        }
        if ($result.edition -eq 'unknown') {
            # Studio installs ship the same exe name; the uninstall entry is the reliable source.
            $result.edition = 'unknown (check Help > About in Resolve)'
        }
    }
    $api = Join-Path $env:ProgramData 'Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting'
    $lib = Join-Path $dir 'fusionscript.dll'
    if (Test-Path -LiteralPath $api) { $result.script_api = $api }
    if (Test-Path -LiteralPath $lib) { $result.script_lib = $lib }
    $mod = Join-Path $api 'Modules\DaVinciResolveScript.py'
    if (Test-Path -LiteralPath $mod) {
        $result.script_modules_ok = $true
        $result.python_module_uses_imp = [bool]((Get-Content -LiteralPath $mod -Raw) -match '(?m)^\s*import\s+imp\b')
    }
    $result.fusion_scripts_dir = Join-Path $env:ProgramData 'Blackmagic Design\DaVinci Resolve\Fusion\Scripts'
    $result.preferences_dir   = Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Preferences'
    return $result
}

function Test-ResolveRunning { [bool](Get-Process -Name 'Resolve' -ErrorAction SilentlyContinue) }

function Get-NvidiaInfo {
    $r = [ordered]@{ nvidia_smi = $null; name = $null; driver = $null; vram_mb = $null; cuda_version = $null }
    $smi = Get-CommandPath 'nvidia-smi'
    if (-not $smi) {
        $cand = Join-Path $env:SystemRoot 'System32\nvidia-smi.exe'
        if (Test-Path $cand) { $smi = $cand }
    }
    if ($smi) {
        $r.nvidia_smi = $smi
        try {
            $q = & $smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>$null | Select-Object -First 1
            if ($q) { $parts = $q -split ','; $r.name = $parts[0].Trim(); $r.driver = $parts[1].Trim(); $r.vram_mb = [int]($parts[2] -replace '[^\d]','') }
            $full = & $smi 2>$null | Out-String
            if ($full -match 'CUDA Version:\s*([\d\.]+)') { $r.cuda_version = $Matches[1] }
        } catch { }
    } else {
        try {
            $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1
            if ($gpu) { $r.name = $gpu.Name; $r.driver = $gpu.DriverVersion }
        } catch { }
    }
    return $r
}

function Get-PythonCandidates {
    # Returns ordered list of python launchers/interpreters with versions, newest-first but preferring 3.10-3.12 for Resolve.
    $out = @()
    $py = Get-CommandPath 'py'
    if ($py) {
        try {
            $list = & $py -0p 2>$null
            foreach ($line in $list) {
                if ($line -match '^\s*-V:(\d+\.\d+)[^\s]*\s+\*?\s*(.+\.exe)\s*$') { $out += [pscustomobject]@{ version = $Matches[1]; path = $Matches[2].Trim(); via = 'py' } }
                elseif ($line -match '^\s*-(\d+\.\d+)-\d+\s+\*?\s*(.+\.exe)\s*$') { $out += [pscustomobject]@{ version = $Matches[1]; path = $Matches[2].Trim(); via = 'py' } }
            }
        } catch { }
    }
    foreach ($n in 'python','python3') {
        $p = Get-CommandPath $n
        if ($p -and -not ($out.path -contains $p)) {
            $v = Get-CommandVersion $n
            if ($v -match '(\d+\.\d+)') { $out += [pscustomobject]@{ version = $Matches[1]; path = $p; via = $n } }
        }
    }
    return $out
}

function Select-PythonForResolve {
    param([string[]]$Preferred = @('3.12','3.11','3.10'))
    $c = Get-PythonCandidates
    foreach ($v in $Preferred) { $hit = $c | Where-Object { $_.version -eq $v } | Select-Object -First 1; if ($hit) { return $hit } }
    return ($c | Sort-Object version -Descending | Select-Object -First 1)
}

function Get-ClaudeConfigPaths {
    [ordered]@{
        user_claude_json   = Join-Path $env:USERPROFILE '.claude.json'
        user_settings      = Join-Path $env:USERPROFILE '.claude\settings.json'
        user_skills_dir    = Join-Path $env:USERPROFILE '.claude\skills'
        user_commands_dir  = Join-Path $env:USERPROFILE '.claude\commands'
        user_agents_dir    = Join-Path $env:USERPROFILE '.claude\agents'
        user_plugins_dir   = Join-Path $env:USERPROFILE '.claude\plugins'
        claude_desktop_cfg = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
    }
}

function Get-ClaudeMcpServers {
    # Parse user-scope MCP servers from ~/.claude.json without needing the CLI.
    $p = (Get-ClaudeConfigPaths).user_claude_json
    if (-not (Test-Path -LiteralPath $p)) { return @{} }
    try {
        $j = Get-Content -LiteralPath $p -Raw | ConvertFrom-Json
        $servers = @{}
        if ($j.PSObject.Properties['mcpServers']) { foreach ($k in $j.mcpServers.PSObject.Properties.Name) { $servers[$k] = $j.mcpServers.$k } }
        return $servers
    } catch { return @{} }
}

function Backup-File {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$BackupDir)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    New-DirectorySafe $BackupDir | Out-Null
    $leaf = Split-Path $Path -Leaf
    $dest = Join-Path $BackupDir $leaf
    if (Test-Path -LiteralPath $Path -PathType Container) {
        Copy-Item -LiteralPath $Path -Destination $dest -Recurse -Force
    } else {
        Copy-Item -LiteralPath $Path -Destination $dest -Force
    }
    return $dest
}

function Test-ClaudeCli { [bool](Get-CommandPath 'claude') }

Export-ModuleMember -Function *
