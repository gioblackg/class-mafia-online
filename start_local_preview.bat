@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)
set APP_MODE=local
node server.js
pause
