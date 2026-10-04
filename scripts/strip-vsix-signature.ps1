[CmdletBinding()]
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName WindowsBase
$package = [System.IO.Packaging.Package]::Open((Resolve-Path -LiteralPath $Path).Path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite)
try {
    $manager = New-Object System.IO.Packaging.PackageDigitalSignatureManager -ArgumentList $package
    $manager.RemoveAllSignatures()
} finally { $package.Close() }
