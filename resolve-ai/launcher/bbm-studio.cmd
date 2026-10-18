@echo off
rem Blue Belt Media Studio - double-click to open the production UI (health check first).
rem   bbm-studio.cmd -Action resume -Project "<name>"     continue a production from its last checkpoint
setlocal
set "HERE=%~dp0"
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoLogo -ExecutionPolicy Bypass -File "%HERE%bbm-studio.ps1" %*
) else (
  powershell -NoLogo -ExecutionPolicy Bypass -File "%HERE%bbm-studio.ps1" %*
)
endlocal
