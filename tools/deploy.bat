@echo off
REM ================================================================
REM  Deploy the latest origin/main to the live site.
REM  Double-click this file, or run it from any Command Prompt.
REM
REM  It asks for an Administrator window if it does not have one,
REM  then runs tools\deploy.ps1: git pull, stop the app, npm install,
REM  npm run build, start the app, check it answers. The site is down
REM  for the two or three minutes the install and build take.
REM
REM  Does nothing if the commit on main is already the one deployed.
REM  To rebuild and restart anyway:  tools\deploy.bat -Force
REM ================================================================
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo This needs an Administrator window. Asking for one...
  REM Start-Process refuses an empty argument list, hence the two forms.
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  )
  exit /b
)

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*

echo.
pause
