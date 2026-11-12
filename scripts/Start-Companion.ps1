[CmdletBinding()]
param(
    [string]$DataDir = '',
    [switch]$NoCodexBridge,
    [switch]$Inspect,
    [ValidateRange(0, 65535)]
    [int]$InspectPort = 0
)

$ErrorActionPreference = 'Stop'
$dataLocation = Join-Path $PSScriptRoot 'Data-Location.ps1'
. $dataLocation
$project = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $project 'runtime\Coopanion-0.2.19\Coopanion.exe'
$DataDir = Resolve-GhostCompanionDataDir $DataDir
$dataPointer = Get-GhostCompanionDataPointerPath
if ($InspectPort -gt 0 -and $InspectPort -lt 1024) {
    throw 'InspectPort must be zero (automatic) or at least 1024.'
}

if (-not (Test-Path -LiteralPath $exe)) {
    & (Join-Path $PSScriptRoot 'Install-Runtime.ps1')
}
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'Coopanion.exe'" | Where-Object {
    $_.ExecutablePath -eq [IO.Path]::GetFullPath($exe) -and
    $_.CommandLine -notmatch '--type=|--import|--pet-url=|host[\\/]electron-main'
})
if ($running.Count -gt 0) {
    throw "Coopanion is already running (process $($running[0].ProcessId)). Exit it from the tray before restarting."
}
& (Join-Path $PSScriptRoot 'Sync-GhostCompanionRuntime.ps1')
& (Join-Path $PSScriptRoot 'Initialize-Companion.ps1') -DataDir $DataDir | Out-Null
& (Join-Path $PSScriptRoot 'Install-CodexBridge.ps1') -DataDir $DataDir -Disable:$NoCodexBridge
$modelEnvironment = & (Join-Path $PSScriptRoot 'Get-ModelEnvironment.ps1') -DataDir $DataDir

$environmentKeys = @('CORTICO_COMPANION_DATA', 'GHOST_COMPANION_DATA_POINTER', 'COOPANION_PACK_ROOTS', 'GHOST_CODEX_BRIDGE_MODULE', 'GHOST_PET_INSPECT_PORT') + @($modelEnvironment.Keys)
$before = @{}
foreach ($key in $environmentKeys) {
    $before[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
try {
    $env:CORTICO_COMPANION_DATA = $DataDir
    $env:GHOST_COMPANION_DATA_POINTER = $dataPointer
    $env:COOPANION_PACK_ROOTS = Join-Path $project 'figures'
    Remove-Item -LiteralPath Env:GHOST_CODEX_BRIDGE_MODULE -ErrorAction SilentlyContinue
    if ($Inspect) {
        $env:GHOST_PET_INSPECT_PORT = if ($InspectPort -gt 0 -and $InspectPort -lt 65535) {
            [string]($InspectPort + 1)
        } else { '0' }
    } else {
        Remove-Item -LiteralPath Env:GHOST_PET_INSPECT_PORT -ErrorAction SilentlyContinue
    }
    foreach ($key in $modelEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $modelEnvironment[$key], 'Process')
    }
    $arguments = @()
    if ($Inspect) {
        $arguments += "--remote-debugging-port=$InspectPort"
        $arguments += '--remote-debugging-address=127.0.0.1'
    }
    $options = @{
        FilePath = $exe
        WorkingDirectory = (Split-Path -Parent $exe)
        PassThru = $true
        WindowStyle = 'Hidden'
    }
    if ($arguments.Count -gt 0) { $options.ArgumentList = $arguments }
    $process = Start-Process @options
    if ($process.WaitForExit(1500)) {
        throw "Coopanion exited before startup (code $($process.ExitCode)). If an existing instance is running, exit it from the tray and start again."
    }
    $artifacts = Join-Path $project 'artifacts'
    New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
    $receipt = @{
        project = 'Coopanion'
        pid = $process.Id
        startedAt = [DateTime]::UtcNow.ToString('o')
        dataDirectory = $env:CORTICO_COMPANION_DATA
        figureRoots = $env:COOPANION_PACK_ROOTS
        runtime = 'Coopanion 0.2.19 portable'
        inspect = [bool]$Inspect
        codexWorld = 'codex-activity'
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText(
        (Join-Path $artifacts 'last-launch.json'),
        $receipt,
        (New-Object Text.UTF8Encoding $false)
    )
    Write-Host "Coopanion started. Process: $($process.Id)"
    Write-Host "Data: $($env:CORTICO_COMPANION_DATA)"
} finally {
    foreach ($key in $environmentKeys) {
        if ($null -eq $before[$key]) {
            Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($key, $before[$key], 'Process')
        }
    }
    $modelEnvironment.Clear()
}
