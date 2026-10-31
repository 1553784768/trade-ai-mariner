$ErrorActionPreference = 'Stop'
$webRoot = Join-Path $PSScriptRoot '../web'
npm --prefix $webRoot ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm --prefix $webRoot run build:export
exit $LASTEXITCODE
