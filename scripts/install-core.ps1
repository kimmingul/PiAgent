[CmdletBinding()]
param(
    [string]$Source,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'PiAgent\runtime'),
    [string]$NodeExecutable = 'node',
    [string]$PipeName = 'piagent-dev',
    [string]$Omp, [string]$Workspace, [switch]$AllowWrites,
    [ValidateSet("restricted","native")][string]$OmpProfile = "restricted"
)
$ErrorActionPreference = 'Stop'
if (-not $Source) { $Source = Split-Path $PSScriptRoot -Parent }
function Assert-PlainPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path refused: $current" }
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}
$sourcePath = [IO.Path]::GetFullPath($Source)
$rootPath = [IO.Path]::GetFullPath($InstallRoot)
Assert-PlainPath $sourcePath; Assert-PlainPath $rootPath
$manifest = Get-Content -LiteralPath (Join-Path $sourcePath 'release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
if ($PipeName -notmatch '^[a-zA-Z0-9_-]{1,128}$') { throw 'Invalid pipe name' }
$runtime = & $NodeExecutable -p 'JSON.stringify({version:process.versions.node,arch:process.arch,platform:process.platform})' | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $runtime.platform -ne 'win32' -or $runtime.arch -notin @('x64','arm64') -or [version]$runtime.version -lt [version]'24.21.0' -or [version]$runtime.version -ge [version]'25.0.0') { throw 'Windows x64/ARM64 Node.js 24.21.0+ (24 LTS) is required' }
$runtimes = & dotnet --list-runtimes
if ($LASTEXITCODE -ne 0 -or -not ($runtimes -match '^Microsoft.NETCore.App (8|9|1[0-9])\.')) { throw '.NET 8+ runtime is required' }
if ($Omp) { $Omp = (Resolve-Path -LiteralPath $Omp).Path }
if ($Workspace) { $Workspace = (Resolve-Path -LiteralPath $Workspace).Path }
if ($OmpProfile -eq 'native' -and (-not $AllowWrites -or -not $Omp -or -not $Workspace)) { throw 'Native OMP requires -Omp, -Workspace and -AllowWrites' }
if ($AllowWrites) {
    if (-not $Workspace) { throw '-AllowWrites requires -Workspace' }
    & git --version | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Git is required for writes' }
}
foreach ($entry in $manifest.sha256.PSObject.Properties) {
    $path = [IO.Path]::GetFullPath((Join-Path $sourcePath $entry.Name))
    if (-not $path.StartsWith($sourcePath.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path' }
    Assert-PlainPath $path
    $hasher = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($path)
    try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    if ($actual -ne $entry.Value) { throw "Release hash mismatch: $($entry.Name)" }
}
# Versioned installs never replace a running release. No global PATH or IDE profile changes.
$target = [IO.Path]::GetFullPath((Join-Path $rootPath $manifest.version))
if (-not $target.StartsWith($rootPath.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation target' }
if (Test-Path -LiteralPath $target) { throw 'This version is already installed; choose another InstallRoot or uninstall it first' }
$sourcePrefix = $sourcePath.TrimEnd('\')+'\'
if ($target.StartsWith($sourcePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'InstallRoot must be outside the release source' }
$sourceItems = Get-ChildItem -LiteralPath $sourcePath -Recurse -Force
foreach ($item in $sourceItems) { Assert-PlainPath $item.FullName }
foreach ($required in @('core.mjs','scripts/start-core.ps1','transport/PiAgent.PipeHost/bin/Release/net8.0-windows/PiAgent.PipeHost.dll')) {
    if (-not $manifest.sha256.PSObject.Properties[$required]) { throw "Incomplete release: $required" }
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
try {
    Get-ChildItem -LiteralPath $sourcePath -Force | Copy-Item -Destination $target -Recurse
    $encoding = New-Object Text.UTF8Encoding($false)
    $settingsJson = @{node=$NodeExecutable;pipe=$PipeName;omp=$Omp;workspace=$Workspace;allowWrites=[bool]$AllowWrites;ompProfile=$OmpProfile} | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $target 'settings.json'),$settingsJson,$encoding)
    $receiptJson = @{product='PiAgent';version=$manifest.version;path=$target;installedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $target 'install-receipt.json'),$receiptJson,$encoding)
} catch { throw "Installation is incomplete at $target. Inspect before removing it. $($_.Exception.Message)" }
Write-Output "Installed: $target"
Write-Output "Start: & '$target\scripts\start-core.ps1'"
