# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param(
    [string]$DataDir = '',
    [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Data-Location.ps1')
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$created = New-Object System.Collections.Generic.List[string]

function Write-NewFile {
    param([string]$Path, [string]$Content)
    if (Test-Path -LiteralPath $Path) { return }
    $parent = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    try {
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::Read
        )
    } catch [System.IO.IOException] {
        if (Test-Path -LiteralPath $Path) { return }
        throw
    }
    try {
        $bytes = $utf8.GetBytes($Content)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
    $created.Add($Path)
}

$DataDir = Resolve-GhostCompanionDataDir $DataDir
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$deployDir = Join-Path $DataDir 'home\companion'
$configFile = Join-Path $deployDir 'config.json'
if (Test-Path -LiteralPath $configFile) {
    [pscustomobject]@{
        DataDir = $DataDir
        Created = @()
        ExistingConfigurationPreserved = $true
    }
    return
}

$templateRoot = Join-Path $ProjectRoot 'config'
$defaults = [System.IO.File]::ReadAllText((Join-Path $templateRoot 'defaults.json'), $utf8)
$provider = [System.IO.File]::ReadAllText((Join-Path $templateRoot 'provider.json'), $utf8)
$persona = [System.IO.File]::ReadAllText((Join-Path $templateRoot 'CONSTITUTION.md'), $utf8)
$project = [System.IO.File]::ReadAllText((Join-Path $ProjectRoot 'project.json'), $utf8) | ConvertFrom-Json
$null = $defaults | ConvertFrom-Json
$null = $provider | ConvertFrom-Json

Write-NewFile (Join-Path $deployDir 'deployment.json') "{`n  `"bot`": `"cormini`"`n}`n"
Write-NewFile (Join-Path $DataDir 'home\providers\ghost-model\config.json') $provider
Write-NewFile (Join-Path $deployDir 'workspace\CONSTITUTION.md') $persona
Write-NewFile $configFile $defaults
# The standard setup wizard may replace the persona. Keep model setup in our own entry point.
$guide = @{ doneAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
Write-NewFile (Join-Path $deployDir 'guide.json') ($guide + "`n")
# Do not queue a first-run release-note model request after a key is added.
$notice = @{ version = $project.runtime.version } | ConvertTo-Json
Write-NewFile (Join-Path $deployDir 'notice.json') ($notice + "`n")

[pscustomobject]@{
    DataDir = $DataDir
    Created = @($created.ToArray())
    ExistingConfigurationPreserved = $false
}
