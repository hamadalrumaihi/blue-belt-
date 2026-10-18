<#
.SYNOPSIS
  Blue Belt Media Studio - Windows launch path for the integrated production workflow.

.DESCRIPTION
  Uses the same bjj-pipeline venv the other Resolve-AI tools use (installed by
  install\04-install-analysis.ps1, editable from this repo, so pulling the branch updates it).

    bbm-studio                    health check, then open the local UI (http://127.0.0.1:8765)
    bbm-studio -Action health     environment report only (FFmpeg flags, NVENC test encode, Resolve edition)
    bbm-studio -Action resume -Project "Qatar_Open_2026_Ahmed"
    bbm-studio -Action status -Project "Qatar_Open_2026_Ahmed"
    bbm-studio -Action setup      (re)install bjj-pipeline + OpenCV into the venv

  Projects live in %USERPROFILE%\BBM-Studio\projects unless BBM_STUDIO_HOME is set
  (point it at a big fast drive, e.g. setx BBM_STUDIO_HOME D:\BBM-Studio).
  Footage is only read; nothing is uploaded.
#>
[CmdletBinding()]
param(
    [ValidateSet('ui', 'health', 'resume', 'status', 'setup')][string]$Action = 'ui',
    [string]$Project,
    [int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
$installDir = (Resolve-Path (Join-Path $PSScriptRoot '..\install')).Path
Import-Module (Join-Path $installDir 'Common.psm1') -Force
$root = Get-ToolsRoot
$bjj = Join-Path $root 'bin\bjj.cmd'

function Ensure-Bjj {
    if (Test-Path -LiteralPath $bjj) { return }
    Write-Host "bjj-pipeline is not installed yet ($bjj missing)." -ForegroundColor Yellow
    Write-Host "Run: powershell -ExecutionPolicy Bypass -File `"$installDir\04-install-analysis.ps1`"" -ForegroundColor Yellow
    Write-Host "or:  bbm-studio -Action setup" -ForegroundColor Yellow
    exit 1
}

switch ($Action) {
    'setup' {
        & (Join-Path $installDir '04-install-analysis.ps1')
        $py = Join-Path $root 'analysis\bjj-pipeline\.venv\Scripts\python.exe'
        if (Test-Path -LiteralPath $py) {
            $uv = Get-CommandPath 'uv'
            if ($uv) { Invoke-Native -File $uv -Arguments @('pip', 'install', '--python', $py, '--quiet', 'opencv-python-headless') | Out-Host }
        }
        & $bjj studio health
    }
    'health' { Ensure-Bjj; & $bjj studio health }
    'status' { Ensure-Bjj; if (-not $Project) { throw '-Project is required' }; & $bjj studio status $Project }
    'resume' { Ensure-Bjj; if (-not $Project) { throw '-Project is required' }; & $bjj studio resume $Project }
    'ui' {
        Ensure-Bjj
        Write-Host 'Checking the environment (FFmpeg, fonts, GPU encode, Resolve)...' -ForegroundColor Cyan
        $h = (& $bjj studio health --no-resolve) -join "`n" | ConvertFrom-Json
        if (-not $h.ok) { Write-Host ("Problems: " + ($h.problems -join '; ')) -ForegroundColor Red }
        foreach ($m in $h.optional_missing) { Write-Host "  optional: $m" -ForegroundColor DarkYellow }
        & $bjj studio ui --port $Port
    }
}
