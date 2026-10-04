[CmdletBinding()]
param([ValidateSet('x86','x64')][string]$Architecture='x86')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$source = Join-Path $workspacePath '.tools/sign-source'
$output = Join-Path $workspacePath ('.tools/sign-'+$Architecture)
$revision = '8e61df9fb776e0c2499dbed0b8037fe450da917b'
if (!(Test-Path -LiteralPath (Join-Path $source '.git'))) {
    & git clone https://github.com/dotnet/sign.git $source
    if ($LASTEXITCODE -ne 0) { throw 'Sign CLI source download failed.' }
    & git -C $source checkout --detach $revision
    if ($LASTEXITCODE -ne 0) { throw 'Sign CLI revision checkout failed.' }
}
if ((& git -C $source rev-parse HEAD) -ne $revision) { throw 'Unexpected Sign CLI source revision.' }
function Patch-PinnedSource([string]$Relative,[string]$Before,[string]$After) {
    $original=(& git -C $source show ($revision+':'+$Relative)) -join "`n"
    if ($LASTEXITCODE -ne 0 -or !$original.Contains($Before)) { throw "Unexpected pinned source: $Relative" }
    [IO.File]::WriteAllText((Join-Path $source $Relative),$original.Replace($Before,$After)+"`n")
}
Patch-PinnedSource 'src/Sign.Cli/Program.cs' 'if (!Environment.Is64BitProcess)' 'if (!Environment.Is64BitProcess && !(args.Length > 0 && new[] { ".vsix", ".dll", ".exe", ".bpl" }.Any(ext => args[^1].EndsWith(ext, StringComparison.OrdinalIgnoreCase))))'
Patch-PinnedSource 'src/Sign.SignatureProviders.CertificateStore/CertificateStoreService.cs' 'return certificate.GetRSAPrivateKey() ?? throw new InvalidOperationException(Resources.CertificateRSANotFound);' 'return PiAgentSigningCredential.OpenRsa(certificate);'
Patch-PinnedSource 'src/Sign.Core/DataFormatSigners/AzureSignToolSigner.cs' 'const int maxAttempts = 3;' 'const int maxAttempts = 1;'
Patch-PinnedSource 'src/Sign.Core/Tools/ToolConfigurationProvider.cs' '"x64", "SignTool.exe.manifest"' '(Environment.Is64BitProcess ? "x64" : "x86"), "SignTool.exe.manifest"'
$signer=Join-Path $source 'src/Sign.Core/DataFormatSigners/AzureSignToolSigner.cs'
$content=[IO.File]::ReadAllText($signer)
[IO.File]::WriteAllText($signer,$content.Replace('".dll",','".dll", ".bpl",'))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'signing/PiAgentSigningCredential.cs') -Destination (Join-Path $source 'src/Sign.SignatureProviders.CertificateStore/PiAgentSigningCredential.cs') -Force
& dotnet publish (Join-Path $source 'src/Sign.Cli/Sign.Cli.csproj') -c Release -r ("win-"+$Architecture) "/p:PlatformTarget=$Architecture" /p:UseAppHost=false /p:UpdateXlfOnBuild=false /p:EnableXlfLocalization=false /p:EnableNGenOptimization=false -o $output
if ($LASTEXITCODE -ne 0) { throw 'Same-process PIN signing tool build failed.' }
$sdkRoot=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$sdk=Get-ChildItem -LiteralPath $sdkRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName "$Architecture/signtool.exe.manifest") } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if(!$sdk){throw "Windows SDK $Architecture signing components are required."}
$sdkOutput=Join-Path $output "tools/SDK/$Architecture"
New-Item -ItemType Directory -Path $sdkOutput -Force | Out-Null
foreach($name in @('signtool.exe.manifest','mssign32.dll','wintrust.dll','wintrust.dll.ini','appxsip.dll','appxpackaging.dll','opcservices.dll','Microsoft.Windows.Build.Signing.mssign32.dll.manifest','Microsoft.Windows.Build.Signing.wintrust.dll.manifest','Microsoft.Windows.Build.Appx.AppxSip.dll.manifest','Microsoft.Windows.Build.Appx.AppxPackaging.dll.manifest','Microsoft.Windows.Build.Appx.OpcServices.dll.manifest')) {
    Copy-Item -LiteralPath (Join-Path $sdk.FullName "$Architecture/$name") -Destination $sdkOutput -Force
}
@{revision=$revision;patch='DPAPI PIN supplied to the actual CSP RSA signer; no UI and no signing retries; PE/BPL/VSIX only on x86';credentialHash=(Get-FileHash (Join-Path $PSScriptRoot 'signing/PiAgentSigningCredential.cs')).Hash;prepareHash=(Get-FileHash $PSCommandPath).Hash} | ConvertTo-Json | Set-Content (Join-Path $output 'source-revision.json')
