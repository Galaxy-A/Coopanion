param(
  [ValidateSet('inspect', 'install')][string]$Mode = 'inspect',
  [string]$Directory = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($Mode -eq 'inspect') {
  $os = Get-CimInstance Win32_OperatingSystem
  @{ build = [int]$os.BuildNumber; boot = $os.LastBootUpTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
  exit 0
}
$setup = Join-Path $Directory 'VBCABLE_Setup_x64.exe'
$signature = Get-AuthenticodeSignature -LiteralPath $setup
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'CN=BUREL VINCENT') {
  throw 'The official VB-CABLE installer signature is invalid or has an unexpected signer.'
}
# Windows owns the installed driver; the downloaded installer stays in the data directory.
$installer = Start-Process -FilePath $setup -ArgumentList @('-i', '-h') -Verb RunAs -WindowStyle Hidden -PassThru
$installer.WaitForExit()
if ($installer.ExitCode -notin @(0, 3010)) { throw "VB-CABLE installer exited with $($installer.ExitCode)." }
@{ exitCode = $installer.ExitCode; restartRequired = $true } | ConvertTo-Json -Compress
