# SPDX-License-Identifier: AGPL-3.0-or-later
Set-StrictMode -Version Latest

function Get-GhostCompanionDataPointerPath {
    $local = if ($env:LOCALAPPDATA) {
        $env:LOCALAPPDATA
    } else {
        [Environment]::GetFolderPath('LocalApplicationData')
    }
    if (-not $local) {
        throw 'Windows LocalAppData is unavailable, so Coopanion cannot locate its data pointer.'
    }
    return [IO.Path]::GetFullPath((Join-Path $local 'GhostCompanion-data-location.json'))
}

function Get-GhostCompanionDefaultDataDir {
    $local = if ($env:LOCALAPPDATA) {
        $env:LOCALAPPDATA
    } else {
        [Environment]::GetFolderPath('LocalApplicationData')
    }
    if (-not $local) {
        throw 'Windows LocalAppData is unavailable, so Coopanion cannot choose a default data directory.'
    }
    return [IO.Path]::GetFullPath((Join-Path $local 'GhostCompanion'))
}

function ConvertTo-GhostCompanionFullPath {
    param([AllowEmptyString()][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    return [IO.Path]::GetFullPath($Path)
}

function Test-GhostCompanionDataRoot {
    param([Parameter(Mandatory)][string]$Path)
    return Test-Path -LiteralPath (Join-Path $Path 'home\companion\config.json') -PathType Leaf
}

function Read-GhostCompanionDataLocation {
    $pointer = Get-GhostCompanionDataPointerPath
    if (-not (Test-Path -LiteralPath $pointer -PathType Leaf)) { return $null }
    try {
        $record = [IO.File]::ReadAllText($pointer, [Text.Encoding]::UTF8) | ConvertFrom-Json
    } catch {
        throw "Coopanion 的数据目录记录无法读取：$pointer"
    }
    if (-not $record -or $record.PSObject.Properties.Name -notcontains 'dataDirectory' -or
        [string]::IsNullOrWhiteSpace([string]$record.dataDirectory)) {
        throw "Coopanion 的数据目录记录无效：$pointer"
    }
    [pscustomobject]@{
        Path = $pointer
        DataDir = ConvertTo-GhostCompanionFullPath ([string]$record.dataDirectory)
        UpdatedAt = if ($record.PSObject.Properties.Name -contains 'updatedAt') { [string]$record.updatedAt } else { '' }
    }
}

function Resolve-GhostCompanionDataDir {
    param([AllowEmptyString()][string]$Requested = '')
    if (-not [string]::IsNullOrWhiteSpace($Requested)) {
        return ConvertTo-GhostCompanionFullPath $Requested
    }
    $record = Read-GhostCompanionDataLocation
    if ($record) {
        if (-not (Test-Path -LiteralPath $record.DataDir -PathType Container)) {
            throw "Coopanion 的数据目录不可用：$($record.DataDir)`n请连接该磁盘后再启动。"
        }
        if (-not (Test-GhostCompanionDataRoot $record.DataDir)) {
            throw "Coopanion 的数据目录不完整：$($record.DataDir)`n需要包含 home\companion\config.json。"
        }
        return $record.DataDir
    }
    return Get-GhostCompanionDefaultDataDir
}

function Write-GhostCompanionDataLocation {
    param([Parameter(Mandatory)][string]$DataDir)
    $DataDir = ConvertTo-GhostCompanionFullPath $DataDir
    if (-not (Test-GhostCompanionDataRoot $DataDir)) {
        throw "不能记录未初始化的 Coopanion 数据目录：$DataDir"
    }
    $pointer = Get-GhostCompanionDataPointerPath
    $parent = Split-Path -Parent $pointer
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    $temp = "$pointer.$([Guid]::NewGuid().ToString('N')).tmp"
    $record = [ordered]@{
        version = 1
        dataDirectory = $DataDir
        updatedAt = [DateTime]::UtcNow.ToString('o')
    }
    try {
        [IO.File]::WriteAllText($temp, (($record | ConvertTo-Json -Depth 4) + "`n"), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temp -Destination $pointer -Force
    } finally {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
}
