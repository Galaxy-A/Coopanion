# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param(
    [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Data-Location.ps1')
$DataDir = Resolve-GhostCompanionDataDir $DataDir
$result = @{}
$providerFile = Join-Path $DataDir 'home\providers\ghost-model\config.json'
$deploymentFile = Join-Path $DataDir 'home\companion\config.json'
if (-not (Test-Path -LiteralPath $providerFile -PathType Leaf) -or
    -not (Test-Path -LiteralPath $deploymentFile -PathType Leaf)) {
    return ,$result
}
$deployment = [System.IO.File]::ReadAllText($deploymentFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if ($deployment.activeProvider -ne 'ghost-model') { return ,$result }
$provider = [System.IO.File]::ReadAllText($providerFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$secretProperty = $provider.PSObject.Properties['secret']
if (-not $secretProperty -or $secretProperty.Value -ne 'GHOST_COMPANION_API_KEY') {
    return ,$result
}
$keyFile = Join-Path $DataDir 'credentials\model-key.dpapi'
if (-not (Test-Path -LiteralPath $keyFile -PathType Leaf)) {
    return ,$result
}

$encrypted = [System.IO.File]::ReadAllText($keyFile, [System.Text.Encoding]::UTF8).Trim()
if (-not $encrypted) { throw 'The saved model credential is empty. Run Configure-Model.cmd again.' }
try {
    $secure = ConvertTo-SecureString -String $encrypted -ErrorAction Stop
} catch {
    throw 'The saved model credential cannot be decrypted by this Windows account. Run Configure-Model.cmd again.'
}
$pointer = [IntPtr]::Zero
try {
    $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $value = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if (-not $value) { throw 'The saved model credential is empty. Run Configure-Model.cmd again.' }
    $result['GHOST_COMPANION_API_KEY'] = $value
    return ,$result
} finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $secure.Dispose()
}
