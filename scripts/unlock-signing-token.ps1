[CmdletBinding()]
param([string]$Thumbprint='3CE49DE1124F325082FA90BDE4944756D1626251')
$ErrorActionPreference='Stop'
& "$PSScriptRoot/assert-signing-credential.ps1" -Thumbprint $Thumbprint
Write-Host 'PIN registration exists. Separate-process pre-authentication is retired; signing scripts supply it to their own CSP RSA key.'
