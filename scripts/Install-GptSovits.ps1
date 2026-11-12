# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param(
    [string]$DataDir = '',
    [ValidateRange(0, 65535)]
    [int]$Port = 0,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Data-Location.ps1')
$packageName = '@wocwang/cortico-world-gpt-sovits-for-coopanion'
$packageVersion = '0.8.8'
$DataDir = Resolve-GhostCompanionDataDir $DataDir

function Invoke-LocalApi {
    param(
        [ValidateSet('Get', 'Post')]
        [string]$Method,
        [string]$Path,
        [object]$Body
    )

    $request = @{
        Method = $Method
        Uri = "$script:baseUrl$Path"
        Headers = @{ Accept = 'application/json' }
        TimeoutSec = 30
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $request.ContentType = 'application/json'
        $request.Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    try {
        return Invoke-RestMethod @request
    } catch {
        throw "Coopanion API $Method $Path failed at $($request.Uri): $($_.Exception.Message)"
    }
}

function Get-DeploymentId {
    param([string]$Path)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($Path))
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Restart-Core {
    param([string]$PreviousBootId)

    try {
        Invoke-LocalApi -Method Post -Path '/api/run/restart' -Body $null | Out-Null
    } catch {
        # The supervised Core can close the HTTP connection while honoring restart.
        if ($_.Exception.Message -notmatch 'connection|reset|closed|refused|terminated') {
            throw
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        try {
            $lifecycle = Invoke-LocalApi -Method Get -Path '/api/run/lifecycle' -Body $null
            if ($lifecycle.ready -and $lifecycle.bootId -ne $PreviousBootId) {
                return $lifecycle
            }
        } catch {
            # The Core is expected to be unavailable during the handoff.
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    throw 'Coopanion Core did not become ready after the restart request.'
}

$configPath = Join-Path $DataDir 'home\companion\config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "No Coopanion configuration was found at $configPath. Start Coopanion once, then run this installer."
}

try {
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    throw "Could not read Coopanion configuration at $configPath as UTF-8 JSON."
}

if ($Port -eq 0) {
    $configuredPort = 0
    if ($config.web -and $config.web.port) {
        [int]::TryParse([string]$config.web.port, [ref]$configuredPort) | Out-Null
    }
    $Port = if ($configuredPort -gt 0) { $configuredPort } else { 17826 }
}
if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Invalid Coopanion WebUI port: $Port"
}
$script:baseUrl = "http://127.0.0.1:$Port"

$lifecycle = Invoke-LocalApi -Method Get -Path '/api/run/lifecycle' -Body $null
if (-not $lifecycle.ready) {
    throw "Coopanion Core at $script:baseUrl is not ready yet."
}
$expectedDeployment = Get-DeploymentId -Path (Join-Path (Split-Path -Parent $configPath) 'data')
if ($lifecycle.deployment -and $lifecycle.deployment -ne $expectedDeployment) {
    throw "The running Coopanion instance uses a different data directory. Stop it or pass the matching -DataDir."
}

$extensions = Invoke-LocalApi -Method Get -Path '/api/extensions' -Body $null
$installed = @($extensions.extensions) | Where-Object { $_.name -eq $packageName } | Select-Object -First 1
$restartNeeded = $false

if ($installed -and $installed.installedVersion -eq $packageVersion -and $installed.state -eq 'loaded') {
    Write-Host "GPT-SoVITS World $packageVersion is already installed."
} elseif ($installed -and $installed.installedVersion -eq $packageVersion -and $installed.state -eq 'pending-restart') {
    Write-Host "GPT-SoVITS World $packageVersion is installed and waiting for a Core restart."
    $restartNeeded = $true
} else {
    $check = Invoke-LocalApi -Method Post -Path '/api/extensions/check' -Body @{
        target = @{ name = $packageName; version = $packageVersion }
        kind = 'world'
    }
    if ($check.kind -ne 'world') {
        throw "The npm package did not report a World extension: $($check.kind)"
    }
    $result = Invoke-LocalApi -Method Post -Path '/api/extensions/install' -Body @{
        name = $packageName
        version = $packageVersion
    }
    Write-Host "Installed $packageName@$packageVersion."
    if ($result.restartRequired) { $restartNeeded = $true }
}

if (-not $Restart) {
    if ($restartNeeded) {
        Write-Host 'Restart Coopanion Core, then open World extensions and enable GPTSovits voice.'
    } else {
        Invoke-LocalApi -Method Post -Path '/api/worlds/activation' -Body @{
            id = 'gpt-sovits'
            enabled = $true
        } | Out-Null
        Write-Host 'GPTSovits voice World is enabled.'
    }
    Write-Host 'The first local voice setup and model download are done from the GPTSovits World page.'
    return
}

if ($restartNeeded) {
    $lifecycle = Restart-Core -PreviousBootId ([string]$lifecycle.bootId)
    $extensions = Invoke-LocalApi -Method Get -Path '/api/extensions' -Body $null
    $loaded = @($extensions.extensions) | Where-Object {
        $_.name -eq $packageName -and $_.state -eq 'loaded'
    } | Select-Object -First 1
    if (-not $loaded) {
        throw "GPT-SoVITS World did not load after restart. Open World extensions to inspect the package error."
    }
}

Invoke-LocalApi -Method Post -Path '/api/worlds/activation' -Body @{
    id = 'gpt-sovits'
    enabled = $true
} | Out-Null
Write-Host "GPTSovits voice World $packageVersion is installed and enabled."
Write-Host 'Open the GPTSovits World page to install the local runtime and model.'
