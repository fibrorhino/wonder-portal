@echo off
REM ================================================================
REM  Replace the broken auto-installed Cloudflared service with a
REM  WinSW-wrapped tunnel service that has the correct run command.
REM  RUN AS ADMINISTRATOR (right-click -> Run as administrator).
REM ================================================================
setlocal
cd /d "%~dp0"

echo === Removing the broken cloudflared service ===
"%~dp0cloudflared.exe" service uninstall 2>nul
sc stop Cloudflared 2>nul
sc delete Cloudflared 2>nul

echo.
echo === Installing the tunnel as a WinSW service (WonderTunnel) ===
"%~dp0wonder-tunnel-svc.exe" install
"%~dp0wonder-tunnel-svc.exe" start

echo.
echo === Status (both should say RUNNING) ===
sc query WonderPortal | findstr /C:"STATE"
sc query WonderTunnel | findstr /C:"STATE"

echo.
echo If WonderTunnel is RUNNING, the site is live at https://wonderwall.nestadt.org
echo.
pause
