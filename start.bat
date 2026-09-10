@echo off
cd /d "%~dp0"
title Class Mafia Server v1.3
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found.
  echo Install Node.js LTS, then run this file again.
  echo https://nodejs.org
  echo.
  pause
  exit /b 1
)
node launcher.js --visible
if errorlevel 1 (
  echo.
  echo [ERROR] The server could not start.
  echo Open server-error.log in this folder for details.
)
echo.
pause
