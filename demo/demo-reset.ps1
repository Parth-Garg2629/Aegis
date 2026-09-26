<#
.SYNOPSIS
Resets the AEGIS demo environment to a clean state.
#>

Write-Host "Resetting AEGIS Demo Environment..." -ForegroundColor Cyan

# 1. Clear test DB
$dbPath = "server/audit.db"
if (Test-Path $dbPath) {
    Remove-Item $dbPath -Force
    Write-Host "Cleared audit.db" -ForegroundColor Green
}

# 2. Reset Chrome profile
$profileDir = "demo/chrome-profile"
if (Test-Path $profileDir) {
    Remove-Item -Recurse -Force $profileDir
    Write-Host "Cleared demo Chrome profile" -ForegroundColor Green
}

# 3. Check for background processes
$pythonProcesses = Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -match "aegis_server.main"}
if ($pythonProcesses) {
    Write-Host "Found running AEGIS server processes. Stopping..." -ForegroundColor Yellow
    $pythonProcesses | Stop-Process -Force
}

# 4. Re-build extension
Write-Host "Rebuilding extension..." -ForegroundColor Yellow
pnpm --filter extension build

Write-Host "Demo reset complete. Ready for preflight checks." -ForegroundColor Green
