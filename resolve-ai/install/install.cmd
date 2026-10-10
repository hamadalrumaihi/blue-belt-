@echo off
rem Blue Belt Media - double-click installer. Keeps this window open so errors stay readable.
rem Same as: powershell -ExecutionPolicy Bypass -File install-all.ps1 [options]
setlocal
cd /d "%~dp0"
powershell -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0install-all.ps1" %*
echo.
if errorlevel 1 (
  echo Installer finished with errors. The log is in C:\AI-Video-Tools\logs\ ^(or the folder set in AI_VIDEO_TOOLS^).
) else (
  echo Installer finished.
)
echo Press any key to close this window.
pause >nul
endlocal
