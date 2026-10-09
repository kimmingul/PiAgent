[CmdletBinding()]
param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Thumbprint)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName WindowsBase
$package = [System.IO.Packaging.Package]::Open((Resolve-Path -LiteralPath $Path).Path,[IO.FileMode]::Open,[IO.FileAccess]::Read)
try {
    $manager = New-Object System.IO.Packaging.PackageDigitalSignatureManager -ArgumentList $package
    if (!$manager.IsSigned -or $manager.VerifySignatures($false) -ne [System.IO.Packaging.VerifyResult]::Success) { throw 'Invalid VSIX content signature.' }
    foreach ($signature in $manager.Signatures) {
        $signer = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $signature.Signer
        if ($signer.Thumbprint -ne $Thumbprint) { throw 'Unexpected VSIX signer.' }
        $chain = New-Object Security.Cryptography.X509Certificates.X509Chain
        try { if (!$chain.Build($signer)) { throw 'VSIX signer certificate chain is not trusted.' } }
        finally { $chain.Dispose() }
    }
    $firstPartyEntries = @('PiAgent.Vsix.dll','PiAgent.Transport.dll')
    if ($package.PartExists([Uri]::new('/diagnostics/PiAgent.Diagnostics.exe',[UriKind]::Relative))) { $firstPartyEntries += 'diagnostics/PiAgent.Diagnostics.exe' }
    foreach ($name in $firstPartyEntries) {
        $temporary = Join-Path ([IO.Path]::GetTempPath()) ('PiAgent-verify-'+[guid]::NewGuid().ToString('N')+[IO.Path]::GetExtension($name))
        try {
            $part = $package.GetPart([Uri]::new('/'+$name,[UriKind]::Relative))
            $input = $part.GetStream([IO.FileMode]::Open,[IO.FileAccess]::Read)
            $output = [IO.File]::Create($temporary)
            try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
            $pe = Get-AuthenticodeSignature -LiteralPath $temporary
            if ($pe.Status -ne 'Valid' -or $pe.SignerCertificate.Thumbprint -ne $Thumbprint -or !$pe.TimeStamperCertificate) { throw "Invalid embedded assembly signature: $name" }
        } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
    }
    Write-Host 'VSIX content signature, signer chain and embedded assembly signatures/timestamps verified.'
} finally { $package.Close() }
