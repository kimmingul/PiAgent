param([ValidateSet('Create','Verify')][string]$Action,[string]$Path,[string]$Thumbprint)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName WindowsBase
if($Action -eq 'Create') {
    $package=[IO.Packaging.Package]::Open($Path,[IO.FileMode]::Create,[IO.FileAccess]::ReadWrite)
    try {
        $part=$package.CreatePart([Uri]::new('/test.txt',[UriKind]::Relative),'text/plain')
        $stream=$part.GetStream();$bytes=[Text.Encoding]::UTF8.GetBytes('PiAgent signing test')
        try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
    }finally{$package.Close()}
}else {
    $package=[IO.Packaging.Package]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read)
    try {
        $manager=New-Object IO.Packaging.PackageDigitalSignatureManager -ArgumentList $package
        if(!$manager.IsSigned -or $manager.VerifySignatures($false) -ne [IO.Packaging.VerifyResult]::Success){throw 'Invalid VSIX content signature.'}
        foreach($signature in $manager.Signatures){
            $cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $signature.Signer
            try{if($cert.Thumbprint -ne $Thumbprint){throw 'Unexpected VSIX test signer.'}}finally{$cert.Dispose()}
        }
        Write-Host 'PASS VSIX content signature and signer; temporary root was not trusted.'
    }finally{$package.Close()}
}
