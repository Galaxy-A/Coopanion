param(
    [ValidateSet('List', 'Capture')][string]$Operation = 'List',
    [int]$TargetProcessId = 0
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'capture.cs') -ReferencedAssemblies 'System.Web.Extensions.dll', 'System.Management.dll'
    if ($Operation -eq 'List') { [HeyboxProcessCapture]::List([Console]::Out) }
    else { [HeyboxProcessCapture]::Run($TargetProcessId, [Console]::OpenStandardInput(), [Console]::Out) }
} catch {
    $failure = $_.Exception
    while ($failure.InnerException) { $failure = $failure.InnerException }
    [Console]::Error.WriteLine($failure.Message)
    exit 1
}
