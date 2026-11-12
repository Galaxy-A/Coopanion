$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'audio.cs') -ReferencedAssemblies 'System.Web.Extensions.dll'
    [HeyboxVoiceAudio]::Run([Console]::OpenStandardInput(), [Console]::Out)
} catch {
    $failure = $_.Exception
    while ($failure.InnerException) { $failure = $failure.InnerException }
    [Console]::Error.WriteLine($failure.Message)
    exit 1
}
