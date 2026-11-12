# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param([string]$DataDir = '', [switch]$Disable)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Data-Location.ps1')
$DataDir = Resolve-GhostCompanionDataDir $DataDir
$runtime = Join-Path $project 'runtime\Coopanion-0.2.19'
$exe = Join-Path $runtime 'Coopanion.exe'
$before = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $mode = if ($Disable) { 'disabled' } else { 'normal' }
    & $exe (Join-Path $project 'integration\install-world.mjs') (Join-Path $runtime 'resources\app') $project $DataDir $mode | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Codex World installation failed; inspect the migration error before restarting.' }
} finally {
    if ($null -eq $before) {
        Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
        [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $before, 'Process')
    }
}
