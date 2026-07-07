@echo off
REM ================================================================
REM  WONDER Portal - install both services (RUN AS ADMINISTRATOR)
REM  Right-click this file -> "Run as administrator".
REM
REM  Prerequisites (we do these together the day-of, before running):
REM    1. cloudflared logged in (browser)  -> creates cert.pem
REM    2. tunnel "wonder-portal" created
REM    3. config.yml present in this folder (filled with the tunnel ID)
REM ================================================================
setlocal
cd /d "%~dp0"

echo.
echo === 1/2  Installing the app service (WinSW -> Next.js on :3000) ===
"%~dp0wonder-portal-svc.exe" install
"%~dp0wonder-portal-svc.exe" start

echo.
echo === 2/2  Installing the Cloudflare Tunnel service ===
if not exist "%~dp0config.yml" (
  echo   config.yml not found - skipping tunnel service install.
  echo   Create it from config.template.yml first.
) else (
  "%~dp0cloudflared.exe" --config "%~dp0config.yml" service install
)

echo.
echo === Service status ===
sc query WonderPortal | findstr /C:"STATE"
sc query Cloudflared 2>nul | findstr /C:"STATE"

echo.
echo Both services are set to start automatically on every boot.
echo The site should be live at https://wonderwall.nestadt.org
echo.
pause
