# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $project 'runtime\Coopanion-0.2.19'
$exe = Join-Path $runtime 'Coopanion.exe'
$before = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $exe (Join-Path $project 'integration\install-adapter.mjs') (Join-Path $runtime 'resources\app') $project | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Codex bridge installation failed; existing local edits were preserved.' }
} finally {
    if ($null -eq $before) {
        Remove-Item -LiteralPath Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
        [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $before, 'Process')
    }
}
