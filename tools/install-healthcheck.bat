@echo off
REM ================================================================
REM  Install the Wonderwall watchdog as a scheduled task.
REM  RIGHT-CLICK this file -> "Run as administrator".
REM
REM  Creates "WonderPortalHealthcheck": runs tools\healthcheck.ps1 every
REM  10 minutes as SYSTEM, starting at boot. If the app stops responding
REM  on localhost:3000 it restarts WonderPortal; if WonderTunnel has
REM  stopped it starts it again. Logs to logs\healthcheck.log.
REM
REM  To remove:  schtasks /delete /tn WonderPortalHealthcheck /f
REM ================================================================
setlocal
cd /d "%~dp0"

echo === Creating scheduled task WonderPortalHealthcheck ===
schtasks /create ^
  /tn "WonderPortalHealthcheck" ^
  /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0healthcheck.ps1\"" ^
  /sc minute /mo 10 ^
  /ru SYSTEM ^
  /rl HIGHEST ^
  /f

if errorlevel 1 (
  echo.
  echo FAILED to create the task. Did you run this as administrator?
  pause
  exit /b 1
)

echo.
echo === Running it once now to check it works ===
schtasks /run /tn "WonderPortalHealthcheck"

timeout /t 15 /nobreak >nul

echo.
echo === Task status ===
schtasks /query /tn "WonderPortalHealthcheck" /fo LIST | findstr /C:"Status" /C:"Next Run Time" /C:"Last Result"

echo.
echo === Watchdog log (should have at least run without error) ===
if exist "%~dp0..\logs\healthcheck.log" (
  type "%~dp0..\logs\healthcheck.log"
) else (
  echo No log entries yet - that is normal if the site was healthy,
  echo the script only writes when something needed attention.
)

echo.
echo Done. The watchdog runs every 10 minutes from now on.
echo.
pause
