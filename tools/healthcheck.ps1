# Wonderwall watchdog.
#
# Run every 10 minutes by the WonderPortalHealthcheck scheduled task (see
# install-healthcheck.bat). Deliberately conservative: it only acts on evidence
# that something is actually wrong, because a needless restart is itself an
# outage.
#
#   - App: request http://localhost:3000/. Two consecutive failures (30s apart)
#     are required before restarting WonderPortal, so one slow response during
#     a CDC query does not trigger anything.
#   - Tunnel: only checks that the WonderTunnel SERVICE is running. It does not
#     probe the public URL — a transient network blip would otherwise cause
#     restarts for a problem that is not on this machine.
#
# Everything is appended to logs\healthcheck.log.

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot   # ...\wonderwall
$logDir  = Join-Path $root 'logs'
$logFile = Join-Path $logDir 'healthcheck.log'
$url     = 'http://localhost:3000/'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Write-Log($message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Add-Content -Path $logFile -Value $line
}

function Test-App {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch {
        return $false
    }
}

try {
    # --- Tunnel: just make sure the service is running ---
    $tunnel = Get-Service -Name 'WonderTunnel' -ErrorAction SilentlyContinue
    if ($null -eq $tunnel) {
        Write-Log 'WonderTunnel service not installed - cannot check tunnel.'
    } elseif ($tunnel.Status -ne 'Running') {
        Write-Log "WonderTunnel is $($tunnel.Status) - starting it."
        Start-Service -Name 'WonderTunnel'
        Write-Log 'WonderTunnel start requested.'
    }

    # --- App: two strikes before acting ---
    if (Test-App) { exit 0 }

    Write-Log 'App did not respond - waiting 30s and retrying before acting.'
    Start-Sleep -Seconds 30
    if (Test-App) {
        Write-Log 'App responded on the retry. No action taken.'
        exit 0
    }

    Write-Log 'App failed twice - restarting WonderPortal.'
    Restart-Service -Name 'WonderPortal' -Force

    Start-Sleep -Seconds 45
    if (Test-App) {
        Write-Log 'App recovered after restart.'
    } else {
        Write-Log 'App STILL not responding after restart - needs a human. Check logs\app.err.log.'
    }
} catch {
    Write-Log "Healthcheck error: $($_.Exception.Message)"
    exit 1
}
