[CmdletBinding()]
param(
    [string]$Thumbprint='3CE49DE1124F325082FA90BDE4944756D1626251',
    [string]$DllPath=(Join-Path $PSScriptRoot '../adapters/visualstudio/PiAgent.Transport/bin/Release/netstandard2.0/PiAgent.Transport.dll'),
    [string]$BplPath=(Join-Path $PSScriptRoot '../adapters/radstudio/bin/Win64/PiAgent370.bpl'),
    [string]$VsixPath=(Join-Path $PSScriptRoot '../adapters/visualstudio/PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix')
)
$ErrorActionPreference='Stop'
& "$PSScriptRoot/assert-signing-credential.ps1" -Thumbprint $Thumbprint
foreach($file in @($DllPath,$BplPath,$VsixPath)){if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw "Build input is missing: $file"}}
$stage=Join-Path (Split-Path $PSScriptRoot -Parent) ('artifacts/token-signing-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
foreach($item in @(@{Source=$DllPath;Name='PiAgent.First.dll'},@{Source=$DllPath;Name='PiAgent.Second.dll'},@{Source=$BplPath;Name='PiAgent.Test.bpl'})) {
    $destination=Join-Path $stage $item.Name
    Copy-Item -LiteralPath $item.Source -Destination $destination
    # Invoke directly so an existing signature cannot skip the actual signing operation.
    & "$PSScriptRoot/invoke-sign-cli.ps1" -Path $destination -Thumbprint $Thumbprint
}
& "$PSScriptRoot/sign-artifacts.ps1" -Directory $stage -Thumbprint $Thumbprint
$vsix=Join-Path $stage 'PiAgent.Test.vsix'
Copy-Item -LiteralPath $VsixPath -Destination $vsix
& "$PSScriptRoot/sign-vsix.ps1" -Path $vsix -Thumbprint $Thumbprint
Write-Host "PASS actual-token signing in fresh processes: two DLLs, BPL, VSIX; output: $stage"
