# Deploy whatever is on origin/main to the live site.
#
# Run through tools\deploy.bat, which asks for an Administrator window (the
# service restart needs one). The steps are the ones in docs\HOST-ON-JHU.md,
# in an order that cannot leave the site half-updated:
#
#   1. Refuse to start if the working copy has local edits.
#   2. git pull (fast-forward only).
#   3. Nothing to do if this commit is already the one deployed.
#   4. Pause the watchdog, so it does not restart the app mid-build.
#   5. Stop WonderPortal. The build rewrites the folder the running app reads
#      from, and a dependency upgrade swaps Next.js itself out from under it,
#      so the app is down for the two or three minutes this takes rather than
#      serving a mixture of old and new.
#   6. npm install, npm run build.
#   7. Start WonderPortal and wait for it to answer.
#   8. Resume the watchdog (always, even if a step above failed).
#
# If the build fails the app is started again on whatever is in .next, and the
# rollback commands are printed. Nothing here calls CDC.
#
# ASCII only: Windows PowerShell 5.1 reads a script without a byte-order mark
# as ANSI, and one stray non-ASCII character becomes a parse error.

param(
    # Rebuild and restart even if this commit is already the one deployed.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot      # ...\wonderwall
$logDir   = Join-Path $root 'logs'
$marker   = Join-Path $logDir 'deployed-commit.txt'
$service  = 'WonderPortal'
$watchdog = 'WonderPortalHealthcheck'
$health   = 'http://localhost:3000/api/health'

Set-Location $root

function Say($message) {
    Write-Host ''
    Write-Host "=== $message ===" -ForegroundColor Cyan
}

# Run a native command and stop the script if it fails. Native tools report
# failure through their exit code, which $ErrorActionPreference does not see.
function Invoke-Step {
    param([string]$What, [scriptblock]$Command)
    Say $What
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

# The repo belongs to the everyday account and this window may be running as a
# different, elevated one; git refuses that combination unless told it is fine.
# (Named Repo, not Git: a function called Git would call itself.)
function Repo { git.exe -c safe.directory=* @args }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin  = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw 'This needs an Administrator window (the service restart requires it). Use tools\deploy.bat.'
}

if (-not (Get-Service -Name $service -ErrorAction SilentlyContinue)) {
    throw "The $service service is not installed on this machine. This script is for the live host only."
}

# --- 1. A clean working copy, or stop -------------------------------------
Say 'Checking the working copy'
$dirty = Repo status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0) { throw 'git status failed. Is this the right folder?' }
if ($dirty) {
    Write-Host $dirty
    throw 'There are uncommitted changes here. Commit or discard them first; a deploy must not overwrite them.'
}

$before = (Repo rev-parse HEAD).Trim()

# --- 2. Get the new code ---------------------------------------------------
Invoke-Step 'Pulling origin/main' { Repo pull --ff-only origin main }

$after = (Repo rev-parse HEAD).Trim()

# --- 3. Anything to do? ----------------------------------------------------
$deployed = ''
if (Test-Path $marker) { $deployed = (Get-Content $marker -TotalCount 1).Trim() }
if (($deployed -eq $after) -and (-not $Force)) {
    Say "Already deployed: $after"
    Write-Host 'Nothing to do. Run with -Force to rebuild and restart anyway.'
    exit 0
}

Write-Host "Deploying $after"
if ($deployed) { Write-Host "Replacing $deployed" }

$watchdogPaused = $false
$stopped = $false
$failed = $false
try {
    # --- 4. Pause the watchdog ---------------------------------------------
    if (Get-ScheduledTask -TaskName $watchdog -ErrorAction SilentlyContinue) {
        Say 'Pausing the watchdog'
        Disable-ScheduledTask -TaskName $watchdog | Out-Null
        $watchdogPaused = $true
    }

    # --- 5. Stop the app ---------------------------------------------------
    Say "Stopping $service (the site is down from here until it restarts)"
    Stop-Service -Name $service -Force
    $stopped = $true

    # --- 6. Install and build ----------------------------------------------
    Invoke-Step 'Installing dependencies (npm install)' { npm install --no-audit --no-fund }
    Invoke-Step 'Building (npm run build)' { npm run build }

    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Set-Content -Path $marker -Value $after -Encoding ASCII
}
catch {
    Write-Host ''
    Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ''
    Write-Host 'The app will be started again on whatever build is in .next.'
    Write-Host 'If the site does not come back, roll back with:'
    Write-Host "    git reset --hard $before"
    Write-Host '    npm install'
    Write-Host '    npm run build'
    Write-Host "    net stop $service ^& net start $service"
    $failed = $true
}
finally {
    # --- 7. Start the app, whatever happened -------------------------------
    if ($stopped) {
        Say "Starting $service"
        try { Start-Service -Name $service } catch { Write-Host "Could not start ${service}: $($_.Exception.Message)" -ForegroundColor Red }
    }
    # --- 8. Resume the watchdog --------------------------------------------
    if ($watchdogPaused) {
        try {
            Enable-ScheduledTask -TaskName $watchdog | Out-Null
            Write-Host 'Watchdog resumed.'
        } catch {
            Write-Host "Could not resume the watchdog. Re-enable the $watchdog task by hand." -ForegroundColor Red
        }
    }
}

if ($failed) { exit 1 }

# --- Did it come back? -----------------------------------------------------
Say 'Waiting for the app to answer'
$answer = $null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 3
    try {
        $answer = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 10
        break
    } catch {
        # A 503 from /api/health still means the app is up; it reports CDC as
        # failing, which is not something a deploy can judge.
        if ($_.Exception.Response) { $answer = $_.Exception.Response; break }
    }
}

if ($null -eq $answer) {
    Write-Host 'The app did not answer on localhost:3000 within a minute.' -ForegroundColor Red
    Write-Host 'Look at logs\ (the service log is there) and consider the rollback above.'
    exit 1
}

Write-Host ''
Write-Host "Deployed $after and the app is answering." -ForegroundColor Green
Write-Host 'Now load the public site and run one real query; only that proves CDC is reachable.'
exit 0
