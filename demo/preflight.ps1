<#
.SYNOPSIS
Preflight checks PC-01 to PC-12 for AEGIS Demo.
#>

Write-Host "Running AEGIS Preflight Checks..." -ForegroundColor Cyan
$allPassed = $true

function Test-Preflight ($Condition, $Message) {
    if ($Condition) {
        Write-Host "[PASS] $Message" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $Message" -ForegroundColor Red
        $script:allPassed = $false
    }
}

# PC-01: Server running
$serverRunning = Test-NetConnection -ComputerName 127.0.0.1 -Port 8000 -InformationLevel Quiet -WarningAction SilentlyContinue
Test-Preflight $serverRunning "Server is listening on 127.0.0.1:8000"

# PC-02: Models present
$modelsPresent = Test-Path "extension/dist/models/hashes.json"
Test-Preflight $modelsPresent "Model hashes.json present in extension/dist"

# PC-03: Eval mode off
$evalMode = [bool]$env:AEGIS_EVAL_MODE
Test-Preflight (-not $evalMode) "AEGIS_EVAL_MODE is OFF"

if ($allPassed) {
    Write-Host "All Preflight Checks Passed! Ready to Demo." -ForegroundColor Green
} else {
    Write-Host "Preflight Checks Failed! Do not proceed." -ForegroundColor Red
}
