$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.local/server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No recorded Allowance server.'; exit 0 }
$recordedId = [int](Get-Content -LiteralPath $pidFile -Raw)
$candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$recordedId"
if ($candidate) {
  if ($candidate.Name -ne 'node.exe' -or $candidate.CommandLine -notmatch 'server/index\.ts.*--production') { throw 'Recorded process no longer matches the Allowance server; left it running.' }
  Stop-Process -Id $recordedId
}
Remove-Item -LiteralPath $pidFile
Write-Output 'Stopped only the recorded Allowance server. Docker and n8n were left running.'
