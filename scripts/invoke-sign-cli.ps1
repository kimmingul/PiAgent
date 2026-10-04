[CmdletBinding()]
param([Parameter(Mandatory)][string]$Path,[string]$Thumbprint='3CE49DE1124F325082FA90BDE4944756D1626251',[string]$TimestampUrl='http://timestamp.globalsign.com/tsa/r6advanced1',[switch]$Interactive)
$ErrorActionPreference='Stop'
$workspacePath=Split-Path $PSScriptRoot -Parent
if($Thumbprint -notmatch '\A[0-9A-Fa-f]{40}\z'){throw 'Invalid certificate thumbprint.'}
& "$PSScriptRoot/assert-signing-credential.ps1" -Thumbprint $Thumbprint -Interactive:$Interactive
$arch=if([Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE','Machine') -eq 'ARM64'){'x86'}else{'x64'}
$toolDirectory=Join-Path $workspacePath ('.tools/sign-'+$arch)
$metadataPath=Join-Path $toolDirectory 'source-revision.json'
$metadata=if(Test-Path $metadataPath){Get-Content $metadataPath -Raw|ConvertFrom-Json}else{$null}
if(!$metadata -or $metadata.credentialHash -ne (Get-FileHash (Join-Path $PSScriptRoot 'signing/PiAgentSigningCredential.cs')).Hash -or $metadata.prepareHash -ne (Get-FileHash (Join-Path $PSScriptRoot 'prepare-sign-cli.ps1')).Hash) {
    & "$PSScriptRoot/prepare-sign-cli.ps1" -Architecture $arch
}
$hostPath=if($arch -eq 'x86'){Join-Path ${env:ProgramFiles(x86)} 'dotnet/dotnet.exe'}else{(Get-Command dotnet).Source}
$cert=Get-Item ('Cert:/CurrentUser/My/'+$Thumbprint)
$sha=[Security.Cryptography.SHA256]::Create()
try{$fingerprint=([BitConverter]::ToString($sha.ComputeHash($cert.RawData))).Replace('-','')}finally{$sha.Dispose()}
$previousInteractive=$env:PIAGENT_SIGNING_INTERACTIVE
try {
    if($Interactive){$env:PIAGENT_SIGNING_INTERACTIVE='1'}else{Remove-Item Env:PIAGENT_SIGNING_INTERACTIVE -ErrorAction SilentlyContinue}
    & $hostPath (Join-Path $toolDirectory 'sign.dll') code certificate-store -cfp $fingerprint -fd sha256 -td sha256 -t $TimestampUrl -m 1 -d PiAgent -rc false (Resolve-Path -LiteralPath $Path).Path
    if($LASTEXITCODE -ne 0){throw 'Signing failed. No automatic PIN retries; check USB connection and the local encrypted credential.'}
}finally{if($null -eq $previousInteractive){Remove-Item Env:PIAGENT_SIGNING_INTERACTIVE -ErrorAction SilentlyContinue}else{$env:PIAGENT_SIGNING_INTERACTIVE=$previousInteractive}}
