[CmdletBinding()]
param([switch]$NoSign, [switch]$SkipAdapterBuild)
$ErrorActionPreference = 'Stop'
if (!$NoSign) { & "$PSScriptRoot/assert-signing-credential.ps1" }
$workspacePath = Split-Path $PSScriptRoot -Parent
Push-Location $workspacePath
try {
    if (!$SkipAdapterBuild) {
        & "$PSScriptRoot/build-adapters.ps1" -RadPlatforms Win32,Win64 -SkipCodeSign:$NoSign
    }
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    $stage = Join-Path $workspacePath "artifacts/setup-$stamp"
    $payload = Join-Path $stage 'payload'
    New-Item -ItemType Directory -Path $payload -Force | Out-Null
    # Existing IDEs can hold the normal build output open. Sign an isolated copy
    # before packaging so release-manifest.json hashes the final signed bytes.
    $pipeHostOutput = Join-Path $stage 'pipe-host'
    $pipeHostArtifacts = Join-Path $stage 'transport-build'
    & dotnet build transport/PiAgent.PipeHost -c Release --artifacts-path $pipeHostArtifacts -o $pipeHostOutput
    if ($LASTEXITCODE -ne 0) { throw 'Isolated pipe host build failed.' }
    if (!$NoSign) { & "$PSScriptRoot/sign-artifacts.ps1" -Directory $pipeHostOutput -AssembliesOnly }
    $packageScript = Join-Path $workspacePath 'scripts/package-core.mjs'
    $coreDestination = Join-Path $payload 'core'
    $packageArguments = @{script=$packageScript;destination=$coreDestination;pipeHostDirectory=$pipeHostOutput} | ConvertTo-Json -Compress
    $env:PIAGENT_SETUP_PACKAGE = $packageArguments
    try {
        & node --input-type=module -e 'import {pathToFileURL} from "node:url"; const a=JSON.parse(process.env.PIAGENT_SETUP_PACKAGE); const m=await import(pathToFileURL(a.script)); await m.packageCore(a.destination,{adapters:true,radPlatforms:["Win32","Win64"],pipeHostDirectory:a.pipeHostDirectory});'
        if ($LASTEXITCODE -ne 0) { throw 'Core payload packaging failed.' }
    } finally { Remove-Item Env:PIAGENT_SETUP_PACKAGE }
    if (!$NoSign) {
        foreach ($relative in @('adapters/radstudio/Win32/PiAgent370.bpl','adapters/radstudio/Win64/PiAgent370.bpl','transport/PiAgent.PipeHost/bin/Release/net8.0-windows/PiAgent.PipeHost.dll')) {
            $signedFile = Join-Path $coreDestination $relative
            $signature = Get-AuthenticodeSignature -LiteralPath $signedFile
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne '3CE49DE1124F325082FA90BDE4944756D1626251' -or !$signature.TimeStamperCertificate) { throw "Missing release signature: $relative" }
        }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/verify-vsix.ps1" -Path (Join-Path $coreDestination 'adapters/visualstudio/PiAgent.Vsix.vsix') -Thumbprint 3CE49DE1124F325082FA90BDE4944756D1626251
        if ($LASTEXITCODE -ne 0) { throw 'Unsigned or invalid VSIX payload.' }
    }
    $cache = Join-Path $workspacePath '.tools/setup-downloads'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    function Download-Checked([string]$Url, [string]$FileName, [string]$Hash, [string]$Algorithm) {
        $target = Join-Path $cache $FileName
        if (!(Test-Path -LiteralPath $target)) { Invoke-WebRequest $Url -OutFile $target }
        if ((Get-FileHash -LiteralPath $target -Algorithm $Algorithm).Hash -ne $Hash) { throw "Download hash mismatch: $FileName" }
        return $target
    }
    $nodeVersion = '24.21.0'
    $nodeHashes = (Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt").Content
    $dotnetReleases = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json'
    $dotnetRelease = $dotnetReleases.releases | Where-Object { $_.runtime.version -eq $dotnetReleases.'latest-runtime' } | Select-Object -First 1
    foreach ($arch in @('x64','arm64')) {
        $nodeName = "node-v$nodeVersion-win-$arch.zip"
        $nodeLine = ($nodeHashes -split "`n" | Where-Object { $_.Trim().EndsWith('  '+$nodeName) })
        if (!$nodeLine) { throw "Missing official Node checksum: $nodeName" }
        $nodeZip = Download-Checked "https://nodejs.org/dist/v$nodeVersion/$nodeName" $nodeName ($nodeLine.Trim().Split(' ')[0]) SHA256
        $nodeExtract = Join-Path $stage "node-$arch"
        Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract
        $nodeTarget = Join-Path $payload "runtimes/$arch/node"
        New-Item -ItemType Directory -Path $nodeTarget -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $nodeExtract "node-v$nodeVersion-win-$arch/node.exe"),(Join-Path $nodeExtract "node-v$nodeVersion-win-$arch/LICENSE") -Destination $nodeTarget
        $runtimeAsset = $dotnetRelease.runtime.files | Where-Object { $_.rid -eq "win-$arch" -and $_.name.EndsWith('.zip') } | Select-Object -First 1
        if (!$runtimeAsset -or !($runtimeAsset.url.StartsWith('https://builds.dotnet.microsoft.com/'))) { throw 'Missing official .NET runtime asset.' }
        $runtimeZip = Download-Checked $runtimeAsset.url ("dotnet-"+$dotnetRelease.runtime.version+"-$arch.zip") $runtimeAsset.hash SHA512
        Expand-Archive -LiteralPath $runtimeZip -DestinationPath (Join-Path $payload "runtimes/$arch/dotnet")
    }
    $hashes = [ordered]@{}
    foreach ($file in (Get-ChildItem -LiteralPath $payload -File -Recurse)) {
        $name = [IO.Path]::GetRelativePath($payload,$file.FullName).Replace('\','/')
        $hashes[$name] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    @{version='0.11.0';signed=(!$NoSign);sha256=$hashes} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $payload 'setup-manifest.json') -Encoding utf8
    $archive = Join-Path $stage 'payload.zip'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($payload,$archive)
    $output = Join-Path $stage 'published'
    & dotnet publish installer/PiAgent.Setup/PiAgent.Setup.csproj -c Release -r win-x64 --self-contained true "-p:PayloadArchive=$archive" -o $output
    if ($LASTEXITCODE -ne 0) { throw 'Unified installer build failed.' }
    if (!$NoSign) { & "$PSScriptRoot/sign-artifacts.ps1" -Directory $output }
    $dist = Join-Path $workspacePath 'dist'
    New-Item -ItemType Directory -Path $dist -Force | Out-Null
    $suffix = if ($NoSign) { '-unsigned-preview' } else { '' }
    $setup = Join-Path $dist "PiAgent-Setup-0.11.0$suffix.exe"
    Copy-Item -LiteralPath (Join-Path $output 'PiAgent-Setup.exe') -Destination $setup
    ((Get-FileHash -LiteralPath $setup).Hash.ToLowerInvariant()+'  '+(Split-Path $setup -Leaf)) | Set-Content "$setup.sha256" -Encoding ascii
    $releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
    foreach ($guide in @(@{source='UNIFIED-INSTALLER.ko.md';target='README.md'},@{source='UNIFIED-INSTALLER.md';target='README.en.md'})) {
        $guideText = Get-Content (Join-Path 'docs' $guide.source) -Raw
        $guideText = [regex]::Replace($guideText,'\]\(([^)]+)\)', { param($match)
            $link = $match.Groups[1].Value
            if ($link -match '^[a-z]+:|^#') { return $match.Value }
            return '](https://github.com/kimmingul/PiAgent/blob/v'+$releaseVersion+'/docs/'+$link+')'
        })
        Set-Content (Join-Path $dist $guide.target) $guideText -Encoding utf8
    }
    Write-Host "Installer: $setup"
} finally { Pop-Location }
