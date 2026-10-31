param([switch]$Fixture, [switch]$SmokeTest)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendRoot = $projectRoot
$frontendRoot = Join-Path $projectRoot 'web'
$pythonPath = Join-Path $backendRoot '.venv/Scripts/python.exe'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nextPath = Join-Path $frontendRoot 'node_modules/next/dist/bin/next'
if (-not (Test-Path -LiteralPath $pythonPath) -or -not (Test-Path -LiteralPath $nextPath)) {
    throw 'Install dependencies as described in README.md first.'
}
$artifactRoot = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
$managedVariables = 'NEXT_TELEMETRY_DISABLED','TRADE_BACKEND','TARIFF_COLLECTOR_MODE','TARIFF_AS_OF_DATE','TARIFF_SCHEDULER_ENABLED'
$previousValues = @{}
foreach ($name in $managedVariables) { $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:TRADE_BACKEND = 'http://127.0.0.1:8017'
if ($Fixture) {
    $env:TARIFF_COLLECTOR_MODE = 'fixture'
    $env:TARIFF_AS_OF_DATE = '2026-10-31'
    $env:TARIFF_SCHEDULER_ENABLED = 'false'
}
$backendProcess = $null
$frontendProcess = $null
function Stop-ManagedProcessTree([int]$processId) {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction SilentlyContinue | ForEach-Object { Stop-ManagedProcessTree $_.ProcessId }
    Stop-Process -Id $processId -ErrorAction SilentlyContinue
}
try {
    $occupied = Get-NetTCPConnection -State Listen -LocalPort 3000,8017 -ErrorAction SilentlyContinue
    if ($occupied) { throw 'Port 3000 or 8017 is already in use.' }
    $backendProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m','uvicorn','app:app','--reload','--host','127.0.0.1','--port','8017') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifactRoot 'backend.log') -RedirectStandardError (Join-Path $artifactRoot 'backend-error.log')
    $frontendProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $nextPath + '"'),'dev','-H','127.0.0.1','-p','3000') -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $artifactRoot 'frontend.log') -RedirectStandardError (Join-Path $artifactRoot 'frontend-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($backendProcess.HasExited -or $frontendProcess.HasExited) { throw 'A server exited; inspect artifacts/*.log.' }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8017/api/tariff/health' -TimeoutSec 2
            $page = Invoke-WebRequest 'http://127.0.0.1:3000/login' -TimeoutSec 5
            if ($health.status -eq 'ok' -and $page.StatusCode -eq 200 -and $page.Content.Contains('Trade AI')) { $ready = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'Servers did not become ready; inspect artifacts/*.log.' }
    Write-Output 'Trade AI: http://127.0.0.1:3000/login'
    if (-not $SmokeTest) {
        while (-not $backendProcess.HasExited -and -not $frontendProcess.HasExited) { Start-Sleep -Seconds 1 }
    }
} finally {
    if ($frontendProcess) { Stop-ManagedProcessTree $frontendProcess.Id }
    if ($backendProcess) { Stop-ManagedProcessTree $backendProcess.Id }
    foreach ($name in $managedVariables) { [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process') }
}
