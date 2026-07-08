@echo off
REM ================================================================
REM  WONDER Portal - install both services (RUN AS ADMINISTRATOR)
REM  Right-click this file -> "Run as administrator".
REM
REM  Installs two boot-level Windows services (start at boot, no login,
REM  both wrapped by WinSW so the run command is explicit and reliable):
REM    - WonderPortal : Next.js app on localhost:3000
REM    - WonderTunnel : Cloudflare Tunnel -> wonderwall.nestadt.org
REM
REM  Prereqs (done once, interactively): cloudflared logged in, tunnel
REM  "wonder-portal" created, config.yml + <id>.json present in this folder.
REM ================================================================
setlocal
cd /d "%~dp0"

echo === 1/2  App service (Next.js on :3000) ===
"%~dp0wonder-portal-svc.exe" install
"%~dp0wonder-portal-svc.exe" start

echo.
echo === 2/2  Cloudflare Tunnel service ===
"%~dp0wonder-tunnel-svc.exe" install
"%~dp0wonder-tunnel-svc.exe" start

echo.
echo === Status (both should say RUNNING) ===
sc query WonderPortal | findstr /C:"STATE"
sc query WonderTunnel | findstr /C:"STATE"

echo.
echo Both services start automatically on every boot.
echo Live at https://wonderwall.nestadt.org
echo.
pause
