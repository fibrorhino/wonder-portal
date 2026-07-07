@echo off
REM ============================================================
REM  WONDER Portal - run locally (double-click this file)
REM  Runs from your own IP, which CDC WONDER does NOT block
REM  (the Vercel-hosted site can't fetch CDC data because CDC
REM  blocks cloud/data-center IPs).
REM ============================================================
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies the first time...
  call npm install
)

echo.
echo Starting WONDER Portal at http://localhost:3000
echo Leave this window open while you use it. Close it to stop.
echo.

REM Open the browser a few seconds after the server starts.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"

call npm run dev
