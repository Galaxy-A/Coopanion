# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param(
    [string]$Model = '',
    [string]$BaseUrl = '',
    [ValidateSet('responses', 'chat', 'anthropic', 'gemini')]
    [string]$Protocol,
    [Security.SecureString]$ApiKey,
    [switch]$KeepApiKey,
    [switch]$NoApiKey,
    [string]$DataDir = '',
    [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Data-Location.ps1')
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$DataDir = Resolve-GhostCompanionDataDir $DataDir
$utf8 = New-Object System.Text.UTF8Encoding($false)

$running = @(Get-Process -Name 'Coopanion' -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -and $_.Path.StartsWith($ProjectRoot + '\', [StringComparison]::OrdinalIgnoreCase) }
    catch { $false }
})
if ($running.Count -gt 0) {
    throw 'Quit Coopanion from its tray menu before changing the model, then run this entry point again.'
}
if ($KeepApiKey -and $NoApiKey) { throw 'KeepApiKey and NoApiKey cannot be combined.' }
if ($ApiKey -and ($KeepApiKey -or $NoApiKey)) { throw 'ApiKey cannot be combined with KeepApiKey or NoApiKey.' }

if (-not $BaseUrl) {
    $BaseUrl = Read-Host 'API base URL (for example https://api.openai.com/v1)'
}
$BaseUrl = $BaseUrl.Trim().TrimEnd('/')
$uri = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$uri)) {
    throw 'Enter an absolute API base URL.'
}
if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.IsLoopback)) {
    throw 'Use HTTPS for remote endpoints. HTTP is supported only for loopback endpoints.'
}
if ($uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw 'The API base URL must not contain credentials, a query or a fragment.'
}
if ($NoApiKey -and -not $uri.IsLoopback) {
    throw 'NoApiKey is supported only for a loopback endpoint.'
}
if (-not $Model) { $Model = Read-Host 'Exact model ID from your provider' }
$Model = $Model.Trim()
if (-not $Model -or $Model -eq 'configure-your-model' -or $Model -match '[\x00-\x1f]') {
    throw 'Enter a real model ID. This project does not guess or substitute a model.'
}
if (-not $Protocol) {
    Write-Host 'Protocols: responses, chat, anthropic, gemini'
    $choice = Read-Host 'Protocol [responses]'
    if (-not $choice) { $choice = 'responses' }
    if (@('responses', 'chat', 'anthropic', 'gemini') -notcontains $choice) {
        throw 'Choose responses, chat, anthropic or gemini.'
    }
    $Protocol = $choice
}
if ($NoApiKey -and @('responses', 'chat') -notcontains $Protocol) {
    throw 'NoApiKey supports only the responses and chat protocols on a loopback endpoint.'
}

& (Join-Path $PSScriptRoot 'Initialize-Companion.ps1') -DataDir $DataDir -ProjectRoot $ProjectRoot | Out-Null
$providerDir = Join-Path $DataDir 'home\providers\ghost-model'
$providerFile = Join-Path $providerDir 'config.json'
$credentialDir = Join-Path $DataDir 'credentials'
$keyFile = Join-Path $credentialDir 'model-key.dpapi'
$deploymentFile = Join-Path $DataDir 'home\companion\config.json'
$deployment = [System.IO.File]::ReadAllText($deploymentFile, $utf8) | ConvertFrom-Json
$oldProvider = [System.IO.File]::ReadAllText($providerFile, $utf8)

$encrypted = $null
if ($KeepApiKey) {
    if (-not (Test-Path -LiteralPath $keyFile -PathType Leaf)) {
        throw 'No encrypted model credential is saved. Enter a new API key instead.'
    }
} elseif (-not $NoApiKey) {
    if (-not $ApiKey) { $ApiKey = Read-Host 'API key (hidden; saved with Windows account encryption)' -AsSecureString }
    if (-not $ApiKey -or $ApiKey.Length -eq 0) { throw 'The API key must not be empty.' }
    $encrypted = ConvertFrom-SecureString -SecureString $ApiKey
}

$provider = [ordered]@{
    kind = 'coo'
    baseUrl = $BaseUrl
    spec = [ordered]@{
        model = $Model
        thinking = $false
        reasoningEffort = 'low'
        maxTokens = 2048
    }
    multimodal = $false
    pricing = @()
    options = @{ protocol = $Protocol }
}
if (-not $NoApiKey) { $provider['secret'] = 'GHOST_COMPANION_API_KEY' }
$deployment.activeProvider = 'ghost-model'
$providerText = ($provider | ConvertTo-Json -Depth 20) + "`n"
$deploymentText = ($deployment | ConvertTo-Json -Depth 50) + "`n"
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$backupDir = Join-Path $DataDir ('backups\model-' + $stamp)
[System.IO.Directory]::CreateDirectory($backupDir) | Out-Null
[System.IO.File]::WriteAllText((Join-Path $backupDir 'provider.json'), $oldProvider, $utf8)
[System.IO.File]::Copy($deploymentFile, (Join-Path $backupDir 'deployment-config.json'), $false)
if (Test-Path -LiteralPath $keyFile) {
    [System.IO.File]::Copy($keyFile, (Join-Path $backupDir 'model-key.dpapi'), $false)
}
if ($encrypted) {
    [System.IO.Directory]::CreateDirectory($credentialDir) | Out-Null
    [System.IO.File]::WriteAllText($keyFile, $encrypted + "`n", $utf8)
}
[System.IO.File]::WriteAllText($providerFile, $providerText, $utf8)
[System.IO.File]::WriteAllText($deploymentFile, $deploymentText, $utf8)
Write-Host 'Model configuration saved. No network request was made.'
Write-Host 'Start Coopanion to use this connection.'
Write-Host ('Configuration backup: ' + $backupDir)
