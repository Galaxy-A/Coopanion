[CmdletBinding()]
param([string]$Compiler = 'clang++', [string]$Output = '')
$ErrorActionPreference = 'Stop'
if (-not $Output) { $Output = Join-Path $PSScriptRoot 'heybox-microphone.dll' }
$source = Join-Path $PSScriptRoot 'microphone-plugin.cpp'
$targetOptions = if ((Split-Path -Leaf $Compiler) -match '^zig(\.exe)?$') { @('c++', '-target', 'x86_64-windows-gnu') } else { @('--target=x86_64-w64-mingw32') }
$importLibrary = [IO.Path]::GetTempFileName()
try {
    & $Compiler @targetOptions -std=c++17 -O2 -shared -static -s -Wall -Wextra -Werror $source -o $Output "-Wl,--out-implib,$importLibrary" -ladvapi32
    if ($LASTEXITCODE -ne 0) { throw "Microphone plugin build failed ($LASTEXITCODE)." }
} finally {
    Remove-Item -LiteralPath $importLibrary -ErrorAction SilentlyContinue
}
Get-Item -LiteralPath $Output | Select-Object FullName, Length
