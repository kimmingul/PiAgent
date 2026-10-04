[CmdletBinding()]
param([string]$Thumbprint='3CE49DE1124F325082FA90BDE4944756D1626251')
$ErrorActionPreference='Stop'
if($Thumbprint -notmatch '\A[0-9A-Fa-f]{40}\z'){throw 'Invalid certificate thumbprint.'}
$directory=Join-Path $env:USERPROFILE '.piagent/signing'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
if((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Signing directory links are forbidden.'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($identity);$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
Set-Acl -LiteralPath $directory -AclObject $acl
$path=Join-Path $directory ($Thumbprint.ToUpperInvariant()+'.clixml')
if((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Signing credential links are forbidden.'}
$pin=Read-Host 'USB certificate PIN (encrypted for this Windows user)' -AsSecureString
try {
    if($pin.Length -eq 0){throw 'Empty PIN is not accepted.'}
    $pin | Export-Clixml -LiteralPath $path -Force
    Write-Host 'Saved using Windows DPAPI. No plaintext PIN is stored.'
} finally {$pin.Dispose()}
