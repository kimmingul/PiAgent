[CmdletBinding()]
param(
    [string]$Path = (Join-Path $PSScriptRoot '../adapters/visualstudio/PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix'),
    [string]$Thumbprint = '3CE49DE1124F325082FA90BDE4944756D1626251',
    [string]$TimestampUrl = 'http://timestamp.globalsign.com/tsa/r6advanced1'
)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/unlock-signing-token.ps1" -Thumbprint $Thumbprint
$workspacePath = Split-Path $PSScriptRoot -Parent
# VSSDK can package project-reference DLLs from obj rather than the signed bin copy.
# Sign the exact packaged first-party bytes, then sign the whole OPC container.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$assemblyStage = Join-Path $workspacePath ('artifacts/vsix-sign-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $assemblyStage | Out-Null
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
try {
    foreach ($name in @('PiAgent.Vsix.dll','PiAgent.Transport.dll')) {
        $entry = $archive.GetEntry($name)
        if (!$entry) { throw "Missing VSIX assembly: $name" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $assemblyStage $name),$false)
    }
} finally { $archive.Dispose() }
& "$PSScriptRoot/sign-artifacts.ps1" -Directory $assemblyStage -AssembliesOnly -Thumbprint $Thumbprint -TimestampUrl $TimestampUrl
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/strip-vsix-signature.ps1" -Path $Path
if ($LASTEXITCODE -ne 0) { throw 'VSIX signature preparation failed.' }
$archive = [IO.Compression.ZipFile]::Open((Resolve-Path -LiteralPath $Path).Path,[IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($name in @('PiAgent.Vsix.dll','PiAgent.Transport.dll')) {
        $archive.GetEntry($name).Delete()
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $assemblyStage $name),$name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
$toolDll = Join-Path $workspacePath '.tools/sign/.store/sign/0.9.1-beta.26475.3/sign/0.9.1-beta.26475.3/tools/net8.0/any/sign.dll'
$hostArchitecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE','Machine')
if ($hostArchitecture -eq 'ARM64') {
    $toolDll = Join-Path $workspacePath '.tools/sign-x86/sign.dll'
    if (!(Test-Path -LiteralPath $toolDll)) { & "$PSScriptRoot/prepare-sign-cli.ps1" }
    $dotnetPath = Join-Path ${env:ProgramFiles(x86)} 'dotnet/dotnet.exe'
} else { $dotnetPath = (Get-Command dotnet).Source }
if (!(Test-Path -LiteralPath $toolDll) -or !(Test-Path -LiteralPath $dotnetPath)) { throw 'Sign CLI and its matching .NET 8 runtime are required.' }
$certificate = Get-Item "Cert:\CurrentUser\My\$Thumbprint"
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = ([BitConverter]::ToString($sha256.ComputeHash($certificate.RawData))).Replace('-','') }
finally { $sha256.Dispose() }
& $dotnetPath $toolDll code certificate-store -cfp $fingerprint -fd sha256 -td sha256 -t $TimestampUrl -m 1 -d PiAgent -rc false $Path
if ($LASTEXITCODE -ne 0) { throw 'VSIX signing failed. Unlock the USB token; no automatic PIN retries are performed.' }
# OPC signature validation is provided by WindowsBase (.NET Framework PowerShell).
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-vsix.ps1') -Path $Path -Thumbprint $Thumbprint
if ($LASTEXITCODE -ne 0) { throw 'VSIX signature validation failed.' }
