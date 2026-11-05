param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $runtime)) { $runtime = (Get-Command node.exe).Source }
$health = $null
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health' -TimeoutSec 2 } catch { }
if ($health -and $health.app -ne 'Allowance') { throw 'Port 4310 is used by another application.' }
if (-not $health) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist/index.html'))) { throw 'Build the app first with npm run build.' }
  New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '.local') -Force | Out-Null
  $process = Start-Process -FilePath $runtime -ArgumentList @('--import','tsx','server/index.ts','--production') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot '.local/server.log') -RedirectStandardError (Join-Path $PSScriptRoot '.local/server-error.log') -PassThru
  Set-Content -LiteralPath (Join-Path $PSScriptRoot '.local/server.pid') -Value $process.Id
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health' -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $health) { throw 'The server did not start. Inspect .local/server-error.log.' }
}
Write-Output 'Allowance: http://127.0.0.1:4310'
Write-Output 'Owner/member workspace ready. Simulation is available; Testnet payments require completed owner wallet and Gas setup.'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:4310' -WindowStyle Hidden }
