# SPDX-License-Identifier: AGPL-3.0-or-later
[CmdletBinding()]
param(
    [switch]$Show,
    [switch]$Choose,
    [string]$MoveTo = '',
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Data-Location.ps1')

$project = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$pointer = Get-GhostCompanionDataPointerPath
$record = Read-GhostCompanionDataLocation
$source = if ($record) { $record.DataDir } else { Get-GhostCompanionDefaultDataDir }

if ($Show -and ($Choose -or -not [string]::IsNullOrWhiteSpace($MoveTo))) {
    throw '-Show 不能和 -Choose 或 -MoveTo 同时使用。'
}

function Same-GhostPath {
    param([Parameter(Mandatory)][string]$Left, [Parameter(Mandatory)][string]$Right)
    return [string]::Equals(
        (ConvertTo-GhostCompanionFullPath $Left).TrimEnd('\'),
        (ConvertTo-GhostCompanionFullPath $Right).TrimEnd('\'),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Is-GhostPathInside {
    param([Parameter(Mandatory)][string]$Child, [Parameter(Mandatory)][string]$Parent)
    $childPath = (ConvertTo-GhostCompanionFullPath $Child).TrimEnd('\') + '\'
    $parentPath = (ConvertTo-GhostCompanionFullPath $Parent).TrimEnd('\') + '\'
    return $childPath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)
}

function Get-GhostDestination {
    if ($Choose -and $MoveTo) { throw '-Choose 和 -MoveTo 不能同时使用。' }
    if ($Choose) {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = '选择 Coopanion 的新数据目录'
        $dialog.ShowNewFolderButton = $true
        $dialog.SelectedPath = Split-Path -Parent $source
        try {
            if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
                return ''
            }
            return $dialog.SelectedPath
        } finally {
            $dialog.Dispose()
        }
    }
    return $MoveTo
}

function Show-GhostDataLocation {
    $exists = Test-Path -LiteralPath $source -PathType Container
    $valid = $exists -and (Test-GhostCompanionDataRoot $source)
    $drive = try { ([IO.Path]::GetPathRoot($source)).TrimEnd('\') } catch { '' }
    Write-Host "数据目录: $source"
    Write-Host "所在磁盘: $drive"
    Write-Host "目录状态: $(if ($valid) { '可用' } elseif ($exists) { '不完整' } else { '不存在' })"
    Write-Host "位置记录: $pointer"
}

if (-not $Choose -and [string]::IsNullOrWhiteSpace($MoveTo)) {
    Show-GhostDataLocation
    return
}

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $project 'runtime'))
$running = @(Get-Process -Name 'Coopanion' -ErrorAction SilentlyContinue | Where-Object {
    try {
        $path = $_.Path
        $path -and [IO.Path]::GetFullPath($path).StartsWith($runtimeRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
    } catch {
        $false
    }
})
if ($running.Count -gt 0) {
    throw '迁移前请从托盘退出 Coopanion。迁移完成后脚本会按需要重新启动。'
}
if (-not (Test-GhostCompanionDataRoot $source)) {
    throw "当前数据目录不完整，无法迁移：$source"
}

$destination = Get-GhostDestination
if (-not $destination) {
    Write-Host '已取消迁移。'
    return
}
$destination = ConvertTo-GhostCompanionFullPath $destination
if (Same-GhostPath $source $destination) {
    throw '新旧数据目录相同，不需要迁移。'
}
if (Is-GhostPathInside $destination $source) {
    throw '新数据目录不能放在旧数据目录里面。'
}
if ((Same-GhostPath $destination $project) -or (Is-GhostPathInside $project $destination)) {
    throw '新数据目录不能是项目目录或包含项目目录的上级目录。'
}
if (Test-Path -LiteralPath (Join-Path $destination 'home\companion\config.json') -PathType Leaf) {
    throw "新数据目录已经包含 Coopanion 数据，拒绝覆盖：$destination"
}
if (Test-Path -LiteralPath $destination -PathType Container) {
    $hasEntries = @(Get-ChildItem -LiteralPath $destination -Force | Select-Object -First 1).Count -gt 0
    if ($hasEntries) {
        throw "新数据目录必须为空：$destination"
    }
} else {
    [IO.Directory]::CreateDirectory($destination) | Out-Null
}

$node = Join-Path $project 'runtime\Coopanion-0.2.19\Coopanion.exe'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    throw '请先启动一次项目以安装便携运行时，然后迁移数据。'
}
$beforeNodeMode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $node (Join-Path $project 'app\data-move.cjs') $source $destination $pointer | Out-Host
    if ($LASTEXITCODE -ne 0) { throw '数据迁移失败，旧数据目录已保留。' }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $beforeNodeMode
}

if ($Restart) {
    $launcher = Join-Path $project 'Start-GhostCompanion.cmd'
    Start-Process -FilePath $launcher -WorkingDirectory $project -WindowStyle Hidden
    Write-Host 'Coopanion 已按新数据目录重新启动。'
} else {
    Write-Host '下次启动 Coopanion 时将使用新数据目录。'
}
