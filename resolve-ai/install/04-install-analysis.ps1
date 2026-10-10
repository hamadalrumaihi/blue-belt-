<#
.SYNOPSIS
  Install the footage-analysis layer: bjj-pipeline (this repo) and HypeCut, each in its own venv.

.DESCRIPTION
  C:\AI-Video-Tools\analysis\
    bjj-pipeline\.venv   <- resolve-ai\bjj (editable), numpy only. `bjj` CLI on PATH via a shim.
    hypecut\             <- clone of Yu-0312/hypecut (Apache-2.0) + .venv with [web,dev] extras (CPU, no torch)

  Evaluated and NOT installed (see docs/REPORT.md): Yutao-Yang/LumenSport (uploads frames to a cloud
  LLM relay, broken imports), Pragyanstha/auto-highlight (Gemini-only, writes empty files),
  AkhilNam/Sports-Highlight-Detector (basketball/soccer heuristics, NameError at runtime).

  -WithGpuExtras installs CUDA 12.x PyTorch + ultralytics (YOLO pose) + openai-whisper into the
  bjj-pipeline venv ONLY (never into the MCP venvs), sized for an RTX 3070 8 GB. ~3 GB download.
#>
[CmdletBinding()]
param(
    [switch]$WithGpuExtras,
    [string]$PythonVersion = '3.12',
    [string]$TorchIndex = 'https://download.pytorch.org/whl/cu124'
)
Import-Module (Join-Path $PSScriptRoot 'Common.psm1') -Force
$ErrorActionPreference = 'Stop'
$root = Get-ToolsRoot
$aRoot = New-DirectorySafe (Join-Path $root 'analysis')
$binDir = New-DirectorySafe (Join-Path $root 'bin')
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$uv = Get-CommandPath 'uv'
if (-not $uv) { throw 'uv not found; run 02-install-mcp.ps1 first (it installs uv) or winget install astral-sh.uv' }

# ---------------------------------------------------------------- a WORKING ffmpeg
# The first ffmpeg on PATH can be a broken stub (e.g. node_modules\ffmpeg-static), so test, do not trust.
$ff = Find-Ffmpeg
if (-not $ff) {
    Write-Log 'No working ffmpeg/ffprobe found; installing Gyan.FFmpeg via winget (per-user, ~100 MB)' 'WARN'
    if (Get-CommandPath 'winget') {
        Invoke-Native -File 'winget' -Arguments @('install', '--id', 'Gyan.FFmpeg', '-e', '--accept-source-agreements', '--accept-package-agreements') | ForEach-Object { Write-Log "  $_" }
    }
    $ff = Find-Ffmpeg
}
if (-not $ff) { throw 'ffmpeg still not available. Install it from https://www.gyan.dev/ffmpeg/builds/ (full build), unzip to C:\ffmpeg, and re-run.' }
Write-Log ("ffmpeg : {0}`n                      ffprobe: {1}" -f $ff.ffmpeg, $ff.ffprobe) 'OK'
# The pipeline honours BJJ_FFMPEG / BJJ_FFPROBE; the shims below also put the good folder first on PATH for HypeCut.
[Environment]::SetEnvironmentVariable('BJJ_FFMPEG', $ff.ffmpeg, 'User')
[Environment]::SetEnvironmentVariable('BJJ_FFPROBE', $ff.ffprobe, 'User')
$env:BJJ_FFMPEG = $ff.ffmpeg; $env:BJJ_FFPROBE = $ff.ffprobe
$env:PATH = "$($ff.dir);$env:PATH"

# ---------------------------------------------------------------- bjj-pipeline
Write-Log 'Installing bjj-pipeline (resolve-ai\bjj) into its own venv' 'STEP'
$bDir = New-DirectorySafe (Join-Path $aRoot 'bjj-pipeline')
$bVenv = Join-Path $bDir '.venv'
$bPy = Join-Path $bVenv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $bPy)) { Invoke-Checked -File $uv -Arguments @('venv', $bVenv, '--python', $PythonVersion, '--quiet') }
$bjjSrc = Join-Path $repoRoot 'resolve-ai\bjj'
$bjjSpec = "${bjjSrc}[dev]"       # braces: "$var[...]" would otherwise be parsed as an index expression
Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $bPy, '--quiet', '-e', $bjjSpec)
# shim so `bjj` works from any terminal without activating the venv (and always sees the good ffmpeg)
@"
@echo off
set "PATH=$($ff.dir);%PATH%"
set "BJJ_FFMPEG=$($ff.ffmpeg)"
set "BJJ_FFPROBE=$($ff.ffprobe)"
"$bVenv\Scripts\bjj.exe" %*
"@ | Set-Content -LiteralPath (Join-Path $binDir 'bjj.cmd') -Encoding ASCII
Invoke-Checked -File $bPy -Arguments @('-m', 'pytest', '-q', '-p', 'no:cacheprovider') -WorkingDirectory $bjjSrc
Write-Log 'bjj-pipeline tests passed' 'OK'

if ($WithGpuExtras) {
    Write-Log "Installing CUDA PyTorch ($TorchIndex), ultralytics, openai-whisper into bjj-pipeline venv" 'STEP'
    $gpu = Get-NvidiaInfo
    if (-not $gpu.name) { Write-Log 'No NVIDIA GPU detected; GPU extras will run on CPU (slow).' 'WARN' }
    Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $bPy, '--quiet', 'torch', 'torchvision', '--index-url', $TorchIndex)
    Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $bPy, '--quiet', 'ultralytics', 'opencv-python-headless', 'openai-whisper')
    Invoke-Native -File $bPy -Arguments @('-c', "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-')") | ForEach-Object { Write-Log "  $_" }
}

# ---------------------------------------------------------------- HypeCut
Write-Log 'Installing HypeCut (Yu-0312/hypecut, Apache-2.0) - CPU, local only' 'STEP'
$hDir = Join-Path $aRoot 'hypecut'
if (-not (Test-Path -LiteralPath (Join-Path $hDir '.git'))) {
    Invoke-Checked -File 'git' -Arguments @('clone', '--depth', '1', 'https://github.com/Yu-0312/hypecut', $hDir)
} else {
    try { Invoke-Checked -File 'git' -Arguments @('-C', $hDir, 'pull', '--ff-only', '--quiet') } catch { Write-Log "hypecut pull skipped: $_" 'WARN' }
}
$hVenv = Join-Path $hDir '.venv'
$hPy = Join-Path $hVenv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $hPy)) { Invoke-Checked -File $uv -Arguments @('venv', $hVenv, '--python', $PythonVersion, '--quiet') }
$hSpec = "${hDir}[web,dev]"
Invoke-Checked -File $uv -Arguments @('pip', 'install', '--python', $hPy, '--quiet', '-e', $hSpec)
$hExe = Join-Path $hVenv 'Scripts\hypecut.exe'
# HypeCut finds ffmpeg via PATH, so the shim puts the working build first.
@"
@echo off
set "PATH=$($ff.dir);%PATH%"
"$hExe" %*
"@ | Set-Content -LiteralPath (Join-Path $binDir 'hypecut.cmd') -Encoding ASCII
Invoke-Native -File $hExe -Arguments @('--version') | ForEach-Object { Write-Log "  $_" }
# Smoke test on a synthetic clip (HypeCut's own suite is 240 tests / ~2 min; run with -Verbose to include it)
$tmp = New-DirectorySafe (Join-Path $root 'tmp')
$clip = Join-Path $tmp 'hypecut-smoke.mp4'
Invoke-Native -File $ff.ffmpeg -Arguments @('-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12',
    '-filter_complex', "[1:a]volume='if(between(t,6,8),8.0,0.05)':eval=frame[a]", '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', $clip) | ForEach-Object { Write-Log "  $_" }
Invoke-Native -File (Join-Path $binDir 'hypecut.cmd') -Arguments @('analyze', $clip, '--json', (Join-Path $tmp 'hypecut-smoke.json'), '-q', '--profile', (Join-Path $hDir 'configs\sports-field.yaml')) | ForEach-Object { Write-Log "  $_" }
if ((Get-LastNativeExitCode) -eq 0 -and (Test-Path (Join-Path $tmp 'hypecut-smoke.json'))) { Write-Log 'HypeCut smoke test OK (sports-field profile)' 'OK' } else { Write-Log 'HypeCut smoke test failed (see lines above)' 'WARN' }
if ($VerbosePreference -eq 'Continue') { Invoke-Checked -File $hPy -Arguments @('-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings') -WorkingDirectory $hDir }

# ---------------------------------------------------------------- user PATH (per-user, no admin)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ";$binDir"), 'User')
    Write-Log "added $binDir to the user PATH (new terminals only)" 'OK'
}
[Environment]::SetEnvironmentVariable('BJJ_HYPECUT', (Join-Path $binDir 'hypecut.cmd'), 'User')

@{ updated = (Get-Date).ToString('s'); ffmpeg = $ff; bjj_pipeline = @{ dir = $bDir; python = $bPy; gpu_extras = [bool]$WithGpuExtras }
   hypecut = @{ dir = $hDir; python = $hPy; exe = (Join-Path $hVenv 'Scripts\hypecut.exe'); profile = (Join-Path $hDir 'configs\sports-field.yaml') }
   not_installed = @('Yutao-Yang/LumenSport (cloud LLM upload)', 'Pragyanstha/auto-highlight (non-functional scaffold)', 'AkhilNam/Sports-Highlight-Detector (runtime NameError, not BJJ)') } |
   ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $aRoot 'analysis.json') -Encoding UTF8
Write-Log 'Analysis layer installed' 'OK'
exit 0
