[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$project = Split-Path -Parent $PSScriptRoot
$version = '0.2.19'
$asset = "Coopanion-$version-win-x64-portable.zip"
$expected = 'CA91B7AB770B8A01C5A04D48809D3BBB46A46BE7963A019CF7C40B5EA6F6E684'
$download = Join-Path $project 'downloads'
$runtime = Join-Path $project "runtime\Coopanion-$version"
$archive = Join-Path $download $asset
$exe = Join-Path $runtime 'Coopanion.exe'

if (Test-Path -LiteralPath $exe) {
    Write-Host "Coopanion $version is ready: $exe"
    return
}

New-Item -ItemType Directory -Path $download -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    $partial = "$archive.partial"
    $uri = "https://github.com/Pal-AI-Lab/Coopanion/releases/download/v$version/$asset"
    Write-Host "Downloading the official Coopanion $version portable release..."
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $partial
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $expected) {
        throw "Download checksum mismatch. The partial file was preserved at $partial"
    }
    Move-Item -LiteralPath $partial -Destination $archive
}

if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
    throw "Archive checksum mismatch: $archive"
}

if (Test-Path -LiteralPath $runtime) {
    throw "Incomplete runtime already exists at $runtime. Inspect it before retrying extraction."
}
Write-Host 'Checksum verified. Extracting the portable runtime...'
Expand-Archive -LiteralPath $archive -DestinationPath $runtime
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Coopanion.exe was not found at the expected archive location: $runtime"
}
Write-Host "Runtime ready: $exe"
