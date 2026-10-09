[CmdletBinding()]
param(
    [string]$Path = (Join-Path $PSScriptRoot '../adapters/visualstudio/PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix'),
    [string]$Thumbprint = '3CE49DE1124F325082FA90BDE4944756D1626251',
    [string]$TimestampUrl = 'http://timestamp.globalsign.com/tsa/r6advanced1',
    [switch]$Interactive
)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/assert-signing-credential.ps1" -Thumbprint $Thumbprint -Interactive:$Interactive
$workspacePath = Split-Path $PSScriptRoot -Parent
# VSSDK can package project-reference DLLs from obj rather than the signed bin copy.
# Sign the exact packaged first-party bytes, then sign the whole OPC container.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$assemblyStage = Join-Path $workspacePath ('artifacts/vsix-sign-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $assemblyStage | Out-Null
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
$firstPartyEntries = @('PiAgent.Vsix.dll','PiAgent.Transport.dll')
# Historical packages have no diagnostics companion; keep their signing workflow usable.
if ($archive.GetEntry('diagnostics/PiAgent.Diagnostics.exe')) { $firstPartyEntries += 'diagnostics/PiAgent.Diagnostics.exe' }
try {
    foreach ($name in $firstPartyEntries) {
        $entry = $archive.GetEntry($name)
        if (!$entry) { throw "Missing VSIX assembly: $name" }
        $stagedAssembly = Join-Path $assemblyStage $name
        New-Item -ItemType Directory -Path (Split-Path $stagedAssembly -Parent) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$stagedAssembly,$false)
    }
} finally { $archive.Dispose() }
& "$PSScriptRoot/sign-artifacts.ps1" -Directory $assemblyStage -AssembliesOnly -Thumbprint $Thumbprint -TimestampUrl $TimestampUrl -Interactive:$Interactive
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/strip-vsix-signature.ps1" -Path $Path
if ($LASTEXITCODE -ne 0) { throw 'VSIX signature preparation failed.' }
$archive = [IO.Compression.ZipFile]::Open((Resolve-Path -LiteralPath $Path).Path,[IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($name in $firstPartyEntries) {
        $archive.GetEntry($name).Delete()
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $assemblyStage $name),$name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
& "$PSScriptRoot/invoke-sign-cli.ps1" -Path $Path -Thumbprint $Thumbprint -TimestampUrl $TimestampUrl -Interactive:$Interactive
# OPC signature validation is provided by WindowsBase (.NET Framework PowerShell).
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-vsix.ps1') -Path $Path -Thumbprint $Thumbprint
if ($LASTEXITCODE -ne 0) { throw 'VSIX signature validation failed.' }
