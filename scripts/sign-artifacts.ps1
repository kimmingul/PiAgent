[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Directory,
    [switch]$AssembliesOnly,
    [string]$Thumbprint = '3CE49DE1124F325082FA90BDE4944756D1626251',
    [string]$TimestampUrl = 'http://timestamp.globalsign.com/tsa/r6advanced1'
)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/unlock-signing-token.ps1" -Thumbprint $Thumbprint
$certificate = Get-Item "Cert:\CurrentUser\My\$Thumbprint"
if (!$certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) { throw 'Valid USB signing certificate required.' }
$hostArchitecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE','Machine')
# SafeNet's provider on this ARM64 workstation exposes the token to x86 processes.
$toolArch = if ($hostArchitecture -eq 'ARM64') { 'x86' } else { 'x64' }
$signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\$toolArch\signtool.exe" |
    Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
if (!$signTool) { throw 'Windows SDK signtool is required.' }
$files = @(Get-ChildItem -LiteralPath $Directory -File -Recurse | Where-Object {
    ($_.Name -like 'PiAgent*.dll' -or $_.Name -like 'PiAgent*.exe' -or $_.Name -like 'PiAgent*.bpl' -or
        (!$AssembliesOnly -and $_.Name -in @('PipeSmoke.exe','ChatSmoke.exe'))) -and
    $_.FullName -notmatch '[\\/]obj[\\/]'
})
if (!$files.Count) { throw "No PiAgent binaries to sign in $Directory" }
foreach ($file in $files) {
    $existing = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($existing.Status -ne 'Valid' -or !$existing.TimeStamperCertificate -or
        $existing.SignerCertificate.Thumbprint -ne $Thumbprint) {
        & $signTool sign /q /s My /sha1 $Thumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $file.FullName
        if ($LASTEXITCODE -ne 0) { throw "Signing failed: $($file.Name). Unlock the USB token; no automatic PIN retries are performed." }
    }
    & $signTool verify /q /pa /tw $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $($file.Name)" }
    $verified = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($verified.Status -ne 'Valid' -or !$verified.TimeStamperCertificate -or
        $verified.SignerCertificate.Thumbprint -ne $Thumbprint) { throw "Unexpected signer/timestamp: $($file.Name)" }
    Write-Host "Signed and verified: $($file.FullName)"
}
