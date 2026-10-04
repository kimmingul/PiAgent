[CmdletBinding()]
param([string]$BplPath,[string]$VsixPath)
$ErrorActionPreference='Stop'
$workspacePath=Split-Path $PSScriptRoot -Parent
$project=Join-Path $PSScriptRoot 'signing/tests/PiAgent.Signing.Tests.csproj'
$stage=Join-Path $workspacePath ('artifacts/signing-tests-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
& dotnet build $project -c Release
if($LASTEXITCODE -ne 0){throw 'Signing tests build failed.'}
$runner=Join-Path $PSScriptRoot 'signing/tests/bin/Release/net8.0-windows/PiAgent.Signing.Tests.dll'
function Test-Runner([string[]]$Arguments) {
    & dotnet $runner @Arguments
    if($LASTEXITCODE -ne 0){throw 'Signing test failed.'}
}
$credential=Join-Path $stage 'fake.clixml'
$pin=ConvertTo-SecureString 'PiAgent test PIN 🚀' -AsPlainText -Force
try{$pin | Export-Clixml -LiteralPath $credential}finally{$pin.Dispose()}
$receipt=Join-Path $stage 'certificate.json'
try {
    Test-Runner @('credential',$credential)
    Test-Runner @('create-test-cert',$receipt)
    $certificate=Get-Content $receipt -Raw | ConvertFrom-Json
    Test-Runner @('reject-software-pin',$receipt,$credential)
    # Also exercise the checked-build DPAPI reader in the x86 process used on ARM64.
    if([Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE','Machine') -eq 'ARM64') {
        $x86Output=Join-Path $stage 'x86-tests'
        & dotnet publish $project -c Release -r win-x86 /p:PlatformTarget=x86 /p:UseAppHost=false --self-contained false -o $x86Output
        if($LASTEXITCODE -ne 0){throw 'x86 signing tests build failed.'}
        & (Join-Path ${env:ProgramFiles(x86)} 'dotnet/dotnet.exe') (Join-Path $x86Output 'PiAgent.Signing.Tests.dll') credential $credential
        if($LASTEXITCODE -ne 0){throw 'x86 DPAPI test failed.'}
    }
    # This certificate is a temporary software key; no USB token or trusted-root changes.
    foreach($extension in @('dll','exe','bpl')) {
        $file=Join-Path $stage ('PiAgent.Test.'+$extension)
        $source=if($extension -eq 'bpl' -and $BplPath){$BplPath}elseif($extension -eq 'exe'){[IO.Path]::ChangeExtension($runner,'.exe')}else{$runner}
        Copy-Item -LiteralPath $source -Destination $file
        $before=(Get-FileHash $file).Hash
        $failed=$false
        try{& "$PSScriptRoot/invoke-sign-cli.ps1" -Path $file -Thumbprint $certificate.thumbprint}catch{$failed=$true}
        if(!$failed -or (Get-FileHash $file).Hash -ne $before){throw 'Missing PIN must fail without changing the input file.'}
        & "$PSScriptRoot/invoke-sign-cli.ps1" -Path $file -Thumbprint $certificate.thumbprint -Interactive
        Test-Runner @('verify-pe',$file,$certificate.thumbprint)
        $result=Get-AuthenticodeSignature -LiteralPath $file
        # The self-signed test cert is deliberately untrusted; hash/signature failures are forbidden.
        if($result.Status -notin @('Valid','NotTrusted','UnknownError') -or $result.SignerCertificate.Thumbprint -ne $certificate.thumbprint -or !$result.TimeStamperCertificate){throw 'PE signature/timestamp test failed.'}
        $tampered=Join-Path $stage 'PiAgent.Tampered.dll'
        Copy-Item $file $tampered
        $data=[IO.File]::ReadAllBytes($tampered);$data[0x30]=$data[0x30] -bxor 1;[IO.File]::WriteAllBytes($tampered,$data)
        if((Get-AuthenticodeSignature $tampered).Status -ne 'HashMismatch'){throw 'Tampered PE content was not rejected.'}
    }
    $vsix=Join-Path $stage 'PiAgent.Test.vsix'
    $fixture=Join-Path $PSScriptRoot 'signing/tests/vsix-fixture.ps1'
    if($VsixPath){
        Copy-Item $VsixPath $vsix
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/strip-vsix-signature.ps1" -Path $vsix
    }else{& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fixture -Action Create -Path $vsix}
    if($LASTEXITCODE -ne 0){throw 'VSIX fixture preparation failed.'}
    $before=(Get-FileHash $vsix).Hash;$failed=$false
    try{& "$PSScriptRoot/sign-vsix.ps1" -Path $vsix -Thumbprint $certificate.thumbprint}catch{$failed=$true}
    if(!$failed -or (Get-FileHash $vsix).Hash -ne $before){throw 'Missing PIN must fail before VSIX modification.'}
    & "$PSScriptRoot/invoke-sign-cli.ps1" -Path $vsix -Thumbprint $certificate.thumbprint -Interactive
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fixture -Action Verify -Path $vsix -Thumbprint $certificate.thumbprint
    if($LASTEXITCODE -ne 0){throw 'VSIX test failed.'}
    Write-Host 'PASS signing regression tests; actual USB stored-PIN signing requires separate live verification.'
}finally {
    if(Test-Path $receipt){
        Test-Runner @('remove-test-cert',$receipt)
        $temporaryCertificate=Get-Content $receipt -Raw | ConvertFrom-Json
        if($temporaryCertificate.container -notlike 'PiAgent-Signing-Test-*'){throw 'Unexpected cleanup receipt.'}
        $certificatePath='Cert:/CurrentUser/My/'+$temporaryCertificate.thumbprint
        # Release the PowerShell certificate provider's cached test-store entry too.
        if(Test-Path $certificatePath){Remove-Item -LiteralPath $certificatePath}
    }
    Remove-Item -LiteralPath $credential -ErrorAction SilentlyContinue
}
