param([Security.SecureString]$Key)
$ErrorActionPreference = 'Stop'
if (-not $Key) { $Key = Read-Host 'Paste the Gas Station Testnet key (hidden)' -AsSecureString }
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Key)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($plain -notmatch '^tg_test_[a-f0-9]{32}$') { throw 'Expected a Gas Station Testnet key.' }
} finally {
  $plain = $null
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$localDirectory = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
$encrypted = ConvertFrom-SecureString -SecureString $Key
[IO.File]::WriteAllText((Join-Path $localDirectory 'velo-gas.dpapi'), $encrypted)
Write-Output 'Testnet Gas key saved using Windows user-bound encryption. Key value is not logged.'
