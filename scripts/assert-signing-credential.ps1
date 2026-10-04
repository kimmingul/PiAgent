[CmdletBinding()]
param([string]$Thumbprint='3CE49DE1124F325082FA90BDE4944756D1626251',[switch]$Interactive)
$ErrorActionPreference='Stop'
if($Thumbprint -notmatch '\A[0-9A-Fa-f]{40}\z'){throw 'Invalid certificate thumbprint.'}
if($Interactive){return}
$path=Join-Path ([Environment]::GetFolderPath('UserProfile')) ('.piagent/signing/'+$Thumbprint.ToUpperInvariant()+'.clixml')
if(!(Test-Path -LiteralPath $path)){throw 'USB PIN has not been registered for PiAgent. Run scripts/set-signing-pin.ps1 once locally. No Token Logon dialog was launched.'}
$current=[IO.Path]::GetFullPath($path)
while($current){if((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Signing credential links are forbidden.'};$current=[IO.Path]::GetDirectoryName($current)}
