# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$project = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtime = Join-Path $project 'runtime\Coopanion-0.2.19'
$runtimeApp = Join-Path $runtime 'resources\app'
$sourceApp = Join-Path $project 'app'
$sourceConsole = Join-Path $project 'build\console'
$sourceProvider = Join-Path $project 'packages\cortico-provider-coo\src'
$targetApp = Join-Path $runtimeApp 'app'
$targetConsole = Join-Path $runtimeApp 'build\console'
$targetProviderPackage = Join-Path $runtimeApp 'node_modules\cortico-provider-coo'
$targetProvider = Join-Path $targetProviderPackage 'src'

if (-not (Test-Path -LiteralPath (Join-Path $runtime 'Coopanion.exe') -PathType Leaf)) {
    throw "Coopanion runtime is not installed: $runtime"
}
if (-not (Test-Path -LiteralPath $sourceApp -PathType Container)) {
    throw "Source app directory is missing: $sourceApp"
}
$node = Join-Path $runtime 'Coopanion.exe'
$pnpm = Join-Path $runtimeApp 'node_modules\pnpm\bin\pnpm.cjs'
$builder = Join-Path $PSScriptRoot 'build-console.mjs'
$runtimeCortico = Join-Path $runtimeApp 'build\cortico'
if (-not (Test-Path -LiteralPath (Join-Path $runtimeCortico 'src\core\language.ts') -PathType Leaf)) {
    throw "Runtime Cortico source is missing: $runtimeCortico"
}
$beforeNodeMode = $env:ELECTRON_RUN_AS_NODE
Push-Location $project
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $node $builder --check | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Installing locked source build dependencies...'
        & $node $pnpm install --frozen-lockfile --ignore-scripts | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Source build dependency installation failed.' }
    }
    & $node $builder --cortico-root $runtimeCortico | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Settings window source build failed.' }
} finally {
    Pop-Location
    $env:ELECTRON_RUN_AS_NODE = $beforeNodeMode
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceProvider 'index.ts') -PathType Leaf)) {
    throw "Provider source is missing: $sourceProvider"
}
if (-not (Test-Path -LiteralPath (Join-Path $targetProviderPackage 'package.json') -PathType Leaf)) {
    throw "Runtime provider package is missing: $targetProviderPackage"
}

[IO.Directory]::CreateDirectory($targetApp) | Out-Null
[IO.Directory]::CreateDirectory($targetConsole) | Out-Null
[IO.Directory]::CreateDirectory($targetProvider) | Out-Null
Copy-Item -Path (Join-Path $sourceApp '*') -Destination $targetApp -Recurse -Force
Copy-Item -Path (Join-Path $sourceConsole '*') -Destination $targetConsole -Recurse -Force
Copy-Item -Path (Join-Path $sourceProvider '*') -Destination $targetProvider -Recurse -Force

Write-Host "Runtime app synced: $runtimeApp"
