# =============================================================================
# run_processor.ps1 — Run the Lexicon index builder inside Docker
# =============================================================================
# Place this file in your lexicon/ folder alongside process.js.
# Make sure Docker Desktop is running, then right-click this file and choose
#       Like really. Make sure it is running. If Docker isn't running, this won't work and you'll get an error.
# "Run with PowerShell", or run it from a PowerShell terminal.
#
# What this does:
#   1. Pulls the official Node.js 20 image (first run only, ~50MB, cached after)
#   2. Mounts your lexicon/ folder into the container at /data
#   3. Runs process.js inside the container
#   4. Container is deleted automatically when done (--rm flag)
#   5. Your index files appear in languages/ — Docker is done, never needed again
# =============================================================================

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Lexicon Index Builder" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Get the directory this script lives in (your lexicon/ folder)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Lexicon folder: $scriptDir" -ForegroundColor Gray
Write-Host ""

# Check Docker is available
try {
    docker info | Out-Null
    Write-Host "[OK] Docker is running." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Docker doesn't appear to be running." -ForegroundColor Red
    Write-Host "        Please start Docker Desktop and try again." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check process.js exists
if (-Not (Test-Path "$scriptDir\process.js")) {
    Write-Host "[ERROR] process.js not found in $scriptDir" -ForegroundColor Red
    Write-Host "        Make sure process.js is in your lexicon/ folder." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check the languages folder exists
if (-Not (Test-Path "$scriptDir\languages")) {
    Write-Host "[ERROR] languages/ folder not found in $scriptDir" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Starting Docker container..." -ForegroundColor Yellow
Write-Host "(If this is your first run, Docker will download the Node.js image." -ForegroundColor Gray
Write-Host " This is about 50MB and only happens once.)" -ForegroundColor Gray
Write-Host ""

# Run the container:
#   --rm          → delete container after it finishes (clean up automatically)
#   -v            → mount your lexicon/ folder as /data inside the container
#   node:20-alpine → small official Node.js 20 image
#   node /data/process.js → the command to run inside the container
docker run --rm `
    -v "${scriptDir}:/data" `
    node:20-alpine `
    node /data/process.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Success! Index files written to languages/" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Confirm the index files exist in your languages/ folder" -ForegroundColor White
    Write-Host "  2. Push everything to GitHub Pages" -ForegroundColor White
    Write-Host "  3. Open lexicon_main.html in a browser to test" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "[ERROR] Something went wrong. Check the output above." -ForegroundColor Red
    Write-Host ""
}

Read-Host "Press Enter to close"
