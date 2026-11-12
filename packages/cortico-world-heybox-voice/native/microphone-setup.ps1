param(
  [ValidateSet('inspect', 'configure', 'remove', 'configurator', 'install', 'worker', 'library')][string]$Mode = 'inspect',
  [ValidateSet('', 'configure', 'remove', 'install')][string]$Operation = '',
  [string]$Token = '',
  [string]$RouteToken = '',
  [string]$EndpointId = '',
  [string]$PluginPath = '',
  [string]$OwnerSid = '',
  [string]$InstallerPath = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$installerHash = '7403be7427bbe1936a40dded082829b6e217fc4f5990fee5cba501f0ae055afa'

function Assert-HeyboxPath([string]$Path) {
  if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '[\r\n"]') { throw 'An absolute local path without quotes or newlines is required.' }
  $resolved = [IO.Path]::GetFullPath($Path)
  if ($resolved.StartsWith('\\')) { throw 'Network paths cannot supply an audio processing component.' }
  $walk = $resolved
  while ($walk) {
    if (Test-Path -LiteralPath $walk) {
      if ((Get-Item -LiteralPath $walk -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse points are not supported: $walk" }
    }
    $parent = Split-Path -Parent $walk
    if ($parent -eq $walk) { break }
    $walk = $parent
  }
  return $resolved
}

function Get-HeyboxEqualizer {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
  try {
    $key = $base.OpenSubKey('SOFTWARE\EqualizerAPO')
    if (-not $key) { return @{ installed = $false; configDir = ''; installDir = '' } }
    try { $config = [string]$key.GetValue('ConfigPath'); $install = [string]$key.GetValue('InstallPath') }
    finally { $key.Dispose() }
    if (-not $install -and $config) { $install = Split-Path -Parent $config }
    if (-not $config -and $install) { $config = Join-Path $install 'config' }
    if ($config) { $config = Assert-HeyboxPath $config }
    if ($install) { $install = Assert-HeyboxPath $install }
    return @{ installed = [bool]($config -and (Test-Path -LiteralPath $config -PathType Container)); configDir = $config; installDir = $install }
  } finally { $base.Dispose() }
}

function Get-HeyboxText([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -gt 4MB) { throw 'Equalizer APO configuration exceeds 4 MiB.' }
  $offset = 0
  $encoding = New-Object Text.UTF8Encoding($false, $true)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { $offset = 3; $encoding = New-Object Text.UTF8Encoding($true, $true) }
  elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) { $offset = 2; $encoding = New-Object Text.UnicodeEncoding($false, $true, $true) }
  elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) { $offset = 2; $encoding = New-Object Text.UnicodeEncoding($true, $true, $true) }
  return @{ bytes = $bytes; encoding = $encoding; text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset) }
}

function ConvertTo-HeyboxBytes($Document, [string]$Text) {
  return [byte[]]($Document.encoding.GetPreamble() + $Document.encoding.GetBytes($Text))
}

function Set-HeyboxAtomic([string]$Path, [byte[]]$Bytes, [string]$Backup = '') {
  $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
  $ownedBackup = $false
  if (-not $Backup) { $Backup = "$Path.$([Guid]::NewGuid().ToString('N')).bak"; $ownedBackup = $true }
  $replacementBackup = $Backup
  $ownedReplacementBackup = $false
  if (Test-Path -LiteralPath $Path) {
    $pathRoot = [IO.Path]::GetPathRoot($Path)
    $backupRoot = [IO.Path]::GetPathRoot($Backup)
    $pathDir = [IO.Path]::GetFullPath((Split-Path -Parent $Path))
    $backupDir = [IO.Path]::GetFullPath((Split-Path -Parent $Backup))
    if ($pathRoot -ine $backupRoot -or $pathDir -ine $backupDir) {
      # File.Replace requires its backup on the same volume and is unreliable
      # across directories on some Windows builds. Preserve the requested
      # backup first, then give Replace a sibling backup beside the target.
      [IO.File]::Copy($Path, $Backup, $true)
      $replacementBackup = "$Path.$([Guid]::NewGuid().ToString('N')).bak"
      $ownedReplacementBackup = $true
    }
  }
  $last = $null
  try {
    [IO.File]::WriteAllBytes($temporary, $Bytes)
    for ($attempt = 1; $attempt -le 5; $attempt++) {
      try {
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, $replacementBackup) }
        else { [IO.File]::Move($temporary, $Path) }
        $last = $null
        break
      } catch {
        $last = $_
        if ($attempt -lt 5) { Start-Sleep -Milliseconds (150 * $attempt) }
      }
    }
    if ($last) { throw "Unable to replace '$Path' after 5 attempts: $($last.Exception.Message)" }
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    if ($ownedReplacementBackup -and (Test-Path -LiteralPath $replacementBackup)) { Remove-Item -LiteralPath $replacementBackup -Force -ErrorAction SilentlyContinue }
    if ($ownedBackup -and (Test-Path -LiteralPath $Backup)) { Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue }
  }
}

# The token-scoped block is the only editable part of the operator's main configuration.
function Update-HeyboxMicrophoneFiles([string]$ConfigDir, [string]$ManagedDir, [string]$Token, [string]$EndpointId,
    [string]$PluginPath, [string]$OwnerSid, [string]$RouteToken, [switch]$Remove) {
  if ($Token -notmatch '^[0-9a-f]{32}$') { throw 'Invalid microphone bridge token.' }
  $ConfigDir = Assert-HeyboxPath $ConfigDir
  $ManagedDir = Assert-HeyboxPath $ManagedDir
  $main = Assert-HeyboxPath (Join-Path $ConfigDir 'config.txt')
  $manifestFile = Join-Path $ManagedDir 'owner.json'
  $previous = $null
  if (Test-Path -LiteralPath $manifestFile) {
    $previous = [IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
    if ($previous.version -ne 1 -or $previous.token -ne $Token) { throw 'The microphone configuration has an unknown owner.' }
  }
  $document = Get-HeyboxText $main
  $before = $document.text
  $begin = "# BEGIN GhostCompanion HeyBox $Token"
  $end = "# END GhostCompanion HeyBox $Token"
  $pattern = '(?m)^' + [regex]::Escape($begin) + '\r?\n[^\r\n]*\r?\n' + [regex]::Escape($end) + '(?:\r?\n|$)'
  $blocks = [regex]::Matches($before, $pattern)
  if ($blocks.Count -gt 1 -or (($before.Contains($begin) -or $before.Contains($end)) -and $blocks.Count -ne 1)) { throw 'The managed microphone Include block is malformed or duplicated.' }
  if ($blocks.Count -eq 1 -and (-not $previous -or $blocks[0].Value -cne $previous.block)) { throw 'The managed microphone Include was modified outside this extension.' }
  if ($previous -and $previous.block -and $blocks.Count -eq 0 -and -not $Remove) { throw 'The managed microphone Include was removed outside this extension; remove the bridge configuration before configuring again.' }
  if ($previous -and $previous.fragmentFile -and (Test-Path -LiteralPath $previous.fragmentFile) -and [IO.File]::ReadAllText($previous.fragmentFile) -cne $previous.fragment) {
    throw 'The managed microphone fragment was modified outside this extension.'
  }
  if ($Remove) {
    if ($blocks.Count -eq 0 -and -not $previous) { return @{ configuredEndpoint = ''; pluginInstalled = $false } }
    $after = $before
    if ($blocks.Count -eq 1) { $after = $before.Remove($blocks[0].Index, $blocks[0].Length) }
    if ($blocks.Count -eq 1 -and $previous.separator -and $blocks[0].Index -eq $previous.prefixLength + $previous.separator.Length -and $blocks[0].Index + $blocks[0].Length -eq $before.Length) {
      $after = $after.Substring(0, $after.Length - $previous.separator.Length)
    }
    $next = @{ version = 1; token = $Token; endpoint = ''; routeToken = ''; block = ''; fragment = ''; fragmentFile = ''; pluginFile = ''; separator = ''; prefixLength = 0 }
  } else {
    if ($EndpointId -notmatch '^\{0\.0\.1\.[0-9a-fA-F]{8}\}\.\{[0-9a-fA-F-]{36}\}$') { throw 'A capture endpoint identifier is required.' }
    if ($OwnerSid -notmatch '^S-1-5-(?:[0-9]+-)*[0-9]+$') { throw 'A Windows user SID is required.' }
    if ($RouteToken -notmatch '^[0-9a-f]{32}$') { throw 'A fresh microphone route token is required.' }
    $PluginPath = Assert-HeyboxPath $PluginPath
    $dll = [IO.File]::ReadAllBytes($PluginPath)
    if ($dll.Length -lt 256 -or $dll.Length -gt 8MB -or $dll[0] -ne 77 -or $dll[1] -ne 90) { throw 'The microphone plugin is not a supported native DLL.' }
    $pe = [BitConverter]::ToInt32($dll, 60)
    if ($pe -lt 64 -or $pe + 6 -gt $dll.Length -or [BitConverter]::ToUInt32($dll, $pe) -ne 17744 -or [BitConverter]::ToUInt16($dll, $pe + 4) -ne 34404) { throw 'The microphone plugin must be a Windows x64 PE image.' }
    $revision = [Guid]::NewGuid().ToString('N')
    $plugin = Join-Path $ManagedDir "heybox-microphone-$revision.dll"
    $fragmentFile = Join-Path $ManagedDir "bridge-$revision.txt"
    $chunk = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("heybox:${RouteToken}:$OwnerSid"))
    $guid = [regex]::Match($EndpointId, '\{[0-9a-fA-F-]{36}\}$').Value
    $fragment = "Device: $guid`r`nVSTPlugin: Library `"$plugin`" ChunkData $chunk`r`nDevice: all`r`n"
    $block = "$begin`r`nInclude: $fragmentFile`r`n$end`r`n"
    $separator = ''
    $prefixLength = $before.Length
    if ($blocks.Count -eq 1) { $after = $before.Remove($blocks[0].Index, $blocks[0].Length).Insert($blocks[0].Index, $block); $separator = [string]$previous.separator; $prefixLength = $previous.prefixLength }
    else {
      if ($before.Length -gt 0 -and -not $before.EndsWith("`n")) { $separator = "`r`n" }
      $after = $before + $separator + $block
    }
    [IO.File]::WriteAllBytes($plugin, $dll)
    [IO.File]::WriteAllText($fragmentFile, $fragment, (New-Object Text.UTF8Encoding($false)))
    $next = @{ version = 1; token = $Token; endpoint = $EndpointId; routeToken = $RouteToken; block = $block; fragment = $fragment; fragmentFile = $fragmentFile; pluginFile = $plugin; separator = $separator; prefixLength = $prefixLength }
  }
  $backup = Join-Path $ManagedDir "config-before-$([Guid]::NewGuid().ToString('N')).txt"
  $current = [IO.File]::ReadAllBytes($main)
  if ([Convert]::ToBase64String($current) -cne [Convert]::ToBase64String($document.bytes)) { throw 'Equalizer APO configuration changed during setup; retry after saving it.' }
  $afterBytes = ConvertTo-HeyboxBytes $document $after
  Set-HeyboxAtomic $main $afterBytes $backup
  try { Set-HeyboxAtomic $manifestFile ([Text.Encoding]::UTF8.GetBytes(($next | ConvertTo-Json -Compress))) }
  catch {
    $current = [IO.File]::ReadAllBytes($main)
    if ([Convert]::ToBase64String($current) -ceq [Convert]::ToBase64String($afterBytes)) { Set-HeyboxAtomic $main $document.bytes }
    throw
  }
  return @{ configuredEndpoint = $next.endpoint; pluginInstalled = -not $Remove }
}

function Get-HeyboxManagedState([string]$ConfigDir, [string]$ManagedDir, [string]$Token) {
  $empty = @{ configuredEndpoint = ''; pluginInstalled = $false; routeToken = '' }
  $manifestFile = Join-Path $ManagedDir 'owner.json'
  if (-not (Test-Path -LiteralPath $manifestFile)) { return $empty }
  $manifest = [IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
  if ($manifest.version -ne 1 -or $manifest.token -ne $Token -or -not $manifest.endpoint) { return $empty }
  $empty.configuredEndpoint = $manifest.endpoint
  if (-not $ConfigDir -or -not (Test-Path -LiteralPath (Join-Path $ConfigDir 'config.txt'))) { return $empty }
  if (-not (Test-Path -LiteralPath $manifest.pluginFile) -or -not (Test-Path -LiteralPath $manifest.fragmentFile)) { return $empty }
  $document = Get-HeyboxText (Join-Path $ConfigDir 'config.txt')
  $empty.pluginInstalled = $document.text.Contains([string]$manifest.block) -and ([IO.File]::ReadAllText($manifest.fragmentFile) -ceq $manifest.fragment)
  if ($empty.pluginInstalled -and $manifest.routeToken -match '^[0-9a-f]{32}$') { $empty.routeToken = $manifest.routeToken }
  else { $empty.pluginInstalled = $false }
  return $empty
}

function Initialize-HeyboxProtectedDirectory([string]$Path) {
  $Path = Assert-HeyboxPath $Path
  if (Test-Path -LiteralPath $Path) {
    $owner = (Get-Acl -LiteralPath $Path).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-18', 'S-1-5-32-544')) { throw "The audio component directory has an unexpected owner: $Path" }
  } else { [IO.Directory]::CreateDirectory($Path) | Out-Null }
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @('S-1-5-32-545','ReadAndExecute'), @('S-1-5-19','ReadAndExecute'), @('S-1-5-20','ReadAndExecute'))) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($entry[0])), $entry[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

if ($Mode -eq 'library') { return }
try {
  if ($Token -notmatch '^[0-9a-f]{32}$') { throw 'Invalid microphone bridge token.' }
  $root = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'GhostCompanion.HeyboxVoice'
  $managed = Join-Path $root $Token
  $equalizer = Get-HeyboxEqualizer
  if ($Mode -eq 'inspect') {
    Add-Type -Path (Join-Path $PSScriptRoot 'microphone-devices.cs')
    $state = Get-HeyboxManagedState $equalizer.configDir $managed $Token
    $os = Get-CimInstance Win32_OperatingSystem
    @{ installed = $equalizer.installed; installDir = $equalizer.installDir; configDir = $equalizer.configDir; configuredEndpoint = $state.configuredEndpoint;
      pluginInstalled = $state.pluginInstalled; devices = @([HeyboxMicrophoneDevices]::List());
      routeToken = $state.routeToken;
      boot = $os.LastBootUpTime.ToUniversalTime().ToString('o'); ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }
  if ($Mode -eq 'configurator') {
    if (-not $equalizer.installed) { throw 'Install Equalizer APO first.' }
    $selector = @('DeviceSelector.exe', 'Configurator.exe') | ForEach-Object { Join-Path $equalizer.installDir $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $selector) { throw 'The Equalizer APO device selector was not found.' }
    $qtRoot = Assert-HeyboxPath (Join-Path $equalizer.installDir 'qt')
    $qtPlatforms = Assert-HeyboxPath (Join-Path $qtRoot 'platforms')
    $qtPlatformPlugin = Join-Path $qtPlatforms 'qwindows.dll'
    if (-not (Test-Path -LiteralPath $qtPlatformPlugin -PathType Leaf)) {
      throw 'Equalizer APO Qt platform plugin is missing. Repair or reinstall Equalizer APO before opening the device selector.'
    }
    $qtConfig = Join-Path $equalizer.installDir 'qt.conf'
    $qtConfigWarning = ''
    if (-not (Test-Path -LiteralPath $qtConfig -PathType Leaf)) {
      try {
        [IO.File]::WriteAllText($qtConfig, "[Paths]`r`nPlugins=qt`r`n", (New-Object Text.UTF8Encoding($false)))
      } catch {
        # The elevated child still receives the explicit plugin paths below. A
        # read-only vendor installation must not prevent the selector opening.
        $qtConfigWarning = "Could not create $qtConfig; using explicit Qt plugin paths instead."
      }
    }
    $env:QT_PLUGIN_PATH = $qtRoot
    $env:QT_QPA_PLATFORM_PLUGIN_PATH = $qtPlatforms
    Start-Process -FilePath $selector -WorkingDirectory $equalizer.installDir -Verb RunAs -WindowStyle Normal | Out-Null
    $result = @{ opened = $true; qtPluginPath = $qtPlatforms }
    if ($qtConfigWarning) { $result.warning = $qtConfigWarning }
    $result | ConvertTo-Json -Compress
    exit 0
  }
  if ($Mode -ne 'worker') {
    if ($Mode -eq 'configure') {
      Add-Type -Path (Join-Path $PSScriptRoot 'microphone-devices.cs')
      if (-not @([HeyboxMicrophoneDevices]::List() | Where-Object { $_.id -ceq $EndpointId }).Count) { throw 'The selected active capture endpoint was not found.' }
      $OwnerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    }
    $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', $PSCommandPath,
      '-Mode','worker','-Operation',$Mode,'-Token',$Token)
    foreach ($pair in @(@('EndpointId',$EndpointId), @('PluginPath',$PluginPath), @('OwnerSid',$OwnerSid), @('InstallerPath',$InstallerPath), @('RouteToken',$RouteToken))) {
      if ($pair[1]) { $arguments += "-$($pair[0])"; $arguments += $pair[1] }
    }
    $quoted = $arguments | ForEach-Object { if ($_ -match '[\r\n"]') { throw 'Invalid setup argument.' }; '"' + $_ + '"' }
    $worker = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList ($quoted -join ' ') -Verb RunAs -WindowStyle Hidden -PassThru
    if (-not $worker.WaitForExit(900000)) { throw 'The setup window is still open. Complete it, then refresh configuration.' }
    if ($worker.ExitCode -ne 0) {
      $receipt = Join-Path $managed 'last-result.json'
      if (Test-Path -LiteralPath $receipt) { $result = [IO.File]::ReadAllText($receipt) | ConvertFrom-Json; throw $result.error }
      throw "Microphone setup exited with $($worker.ExitCode)."
    }
    @{ ok = $true } | ConvertTo-Json -Compress
    exit 0
  }
  $administrator = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $administrator.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator approval is required to configure the audio component.' }
  Initialize-HeyboxProtectedDirectory $root
  Initialize-HeyboxProtectedDirectory $managed
  if ($Operation -eq 'install') {
    $InstallerPath = Assert-HeyboxPath $InstallerPath
    $installer = [IO.File]::ReadAllBytes($InstallerPath)
    if ($installer.Length -gt 32MB) { throw 'Equalizer APO installer exceeds 32 MiB.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($sha.ComputeHash($installer))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($actual -cne $installerHash) { throw 'The Equalizer APO installer did not match the official SHA-256.' }
    $safeInstaller = Join-Path $managed 'EqualizerAPO-x64-1.4.2.exe'
    [IO.File]::WriteAllBytes($safeInstaller, $installer)
    $process = Start-Process -FilePath $safeInstaller -WindowStyle Normal -PassThru
    if (-not $process.WaitForExit(900000)) { throw 'Equalizer APO installation is still running. Complete it, then refresh configuration.' }
    if ($process.ExitCode -notin @(0, 3010)) { throw "Equalizer APO installer exited with $($process.ExitCode)." }
  } else {
    if (-not $equalizer.installed) { throw 'Install Equalizer APO first.' }
    if ($Operation -eq 'configure') {
      Add-Type -Path (Join-Path $PSScriptRoot 'microphone-devices.cs')
      if (-not @([HeyboxMicrophoneDevices]::List() | Where-Object { $_.id -ceq $EndpointId }).Count) { throw 'The selected active capture endpoint was not found.' }
    }
    Update-HeyboxMicrophoneFiles $equalizer.configDir $managed $Token $EndpointId $PluginPath $OwnerSid $RouteToken -Remove:($Operation -eq 'remove') | Out-Null
  }
  [IO.File]::WriteAllText((Join-Path $managed 'last-result.json'), '{"ok":true}', (New-Object Text.UTF8Encoding($false)))
  exit 0
} catch {
  if ($Mode -eq 'worker' -and $managed -and (Test-Path -LiteralPath $managed)) {
    try { [IO.File]::WriteAllText((Join-Path $managed 'last-result.json'), (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false))) } catch { }
  }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
