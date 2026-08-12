@echo off
REM ====================================================================
REM  Downloads the public-domain backdrop plates into art\
REM  Just double-click this file. No arguments needed.
REM
REM  Optional, from a terminal:
REM     fetch-plates.cmd --dry            resolve titles, download nothing
REM     fetch-plates.cmd --force          re-download everything
REM     fetch-plates.cmd --width 2000     request a larger rendering
REM ====================================================================

REM %~dp0 is this file's own folder, so the working directory is correct
REM no matter where the script is launched from.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on your PATH.
  echo   Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

echo.
node tools\fetch-plates.mjs %*
echo.
echo   Done. Open index.html and press P to see the credits.
echo.
pause
