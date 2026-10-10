@echo off
rem Blue Belt Media - Resolve AI launcher (double-click or run `bbm-video` after install-all.ps1)
setlocal
set "HERE=%~dp0"
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoLogo -ExecutionPolicy Bypass -File "%HERE%bbm-video.ps1" %*
) else (
  powershell -NoLogo -ExecutionPolicy Bypass -File "%HERE%bbm-video.ps1" %*
)
endlocal
