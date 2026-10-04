@echo off
rem Blue Belt Media capture agent — Windows start script.
rem Keeps this window open; close it or press Ctrl+C to stop the agent.
setlocal
cd /d "%~dp0"
if not exist agent.env (
  echo agent.env is missing. Copy agent.env.example to agent.env and fill in APP_URL and CAPTURE_TOKEN.
  pause
  exit /b 2
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org and start again.
  pause
  exit /b 2
)
if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 ( pause & exit /b 1 )
)
title Blue Belt Media - Capture agent
node src\main.mjs
echo.
echo Agent stopped. Press any key to close this window.
pause >nul
