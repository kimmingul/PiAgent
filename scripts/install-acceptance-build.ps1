[CmdletBinding()]
param([Parameter(Mandatory)][string]$CorePackage)
$ErrorActionPreference='Stop'
$workspaceRoot=Split-Path $PSScriptRoot -Parent
$packagePath=(Resolve-Path -LiteralPath $CorePackage).Path
$manifest=Get-Content -LiteralPath (Join-Path $packagePath 'release-manifest.json') -Raw | ConvertFrom-Json
foreach($entry in $manifest.sha256.PSObject.Properties){
  $target=[IO.Path]::GetFullPath((Join-Path $packagePath $entry.Name))
  if(!$target.StartsWith($packagePath+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Package path escaped'}
  if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value){throw "Package hash mismatch: $($entry.Name)"}
}
if(Get-Process devenv,bds -ErrorAction SilentlyContinue){throw 'Close IDEs before applying an acceptance build'}
$installRoot=Join-Path $env:LOCALAPPDATA 'Programs\PiAgent'
$receiptPath=Join-Path $installRoot 'install-receipt.json'
$receipt=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
$stamp=[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$evidence=Join-Path $workspaceRoot "artifacts\installed-acceptance-$stamp"
New-Item -ItemType Directory -Path $evidence | Out-Null
Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $evidence 'previous-receipt.json')
$radKey='HKCU:\Software\Embarcadero\BDS\37.0\Known Packages x64'
$previousRad=@((Get-Item -LiteralPath $radKey).Property | Where-Object { [IO.Path]::GetFileName($_) -eq 'PiAgent370.bpl' } | ForEach-Object { @{Name=$_;Value=(Get-Item -LiteralPath $radKey).GetValue($_)} })
$previousRad | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'previous-rad64.json') -Encoding utf8
$vsRoot='C:\Program Files\Microsoft Visual Studio\18\Community'
$extensionRoot=Join-Path $env:LOCALAPPDATA 'Microsoft\VisualStudio\18.0_4dee894c\Extensions'
$oldExtension=Get-ChildItem -LiteralPath $extensionRoot -Directory | Where-Object { $extensionManifest=Join-Path $_.FullName 'extension.vsixmanifest'; (Test-Path -LiteralPath $extensionManifest) -and ([IO.File]::ReadAllText($extensionManifest).Contains('PiAgent.Vsix.38557171-e01d-4d7b-9842-3b435c5eed83')) }
foreach($extension in $oldExtension){Copy-Item -LiteralPath $extension.FullName -Destination (Join-Path $evidence 'previous-vsix-extension') -Recurse}
$release=Join-Path $installRoot ("releases\"+$manifest.version+"-acceptance-$stamp")
New-Item -ItemType Directory -Path $release | Out-Null
Copy-Item -LiteralPath $packagePath -Destination (Join-Path $release 'core') -Recurse
Copy-Item -LiteralPath (Join-Path $receipt.Release 'runtimes') -Destination (Join-Path $release 'runtimes') -Recurse
$dependencies=Join-Path $release 'dependencies\omp';New-Item -ItemType Directory -Path $dependencies -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspaceRoot '.tools\omp-18.6.0\omp.exe') -Destination (Join-Path $dependencies 'omp.exe')
$settings=Get-Content -LiteralPath (Join-Path $receipt.Release 'core\settings.json') -Raw | ConvertFrom-Json
$settings.node=Join-Path $release 'runtimes\arm64\node\node.exe';$settings.omp=Join-Path $dependencies 'omp.exe'
$settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $release 'core\settings.json') -Encoding utf8
# Stop only the old, verified installed PiAgent daemon, with no IDE clients running.
$oldCore=Join-Path $receipt.Release 'core\core.mjs'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($oldCore) } | ForEach-Object { Stop-Process -Id $_.ProcessId }
$installer=Join-Path $vsRoot 'Common7\IDE\VSIXInstaller.exe'
$uninstall=Start-Process -FilePath $installer -ArgumentList @('/quiet','/instanceIds:4dee894c','/uninstall:PiAgent.Vsix.38557171-e01d-4d7b-9842-3b435c5eed83',("/logFile:`""+(Join-Path $evidence 'vsix-uninstall.log')+'"')) -WindowStyle Hidden -Wait -PassThru
if($uninstall.ExitCode -notin @(0,1001,2003)){throw "VSIX uninstall failed: $($uninstall.ExitCode); $evidence"}
$vsix=Join-Path $release 'core\adapters\visualstudio\PiAgent.Vsix.vsix'
$install=Start-Process -FilePath $installer -ArgumentList @('/quiet','/instanceIds:4dee894c',("/logFile:`""+(Join-Path $evidence 'vsix-install.log')+'"'),("`"$vsix`"")) -WindowStyle Hidden -Wait -PassThru
if($install.ExitCode -notin @(0,1001)){throw "VSIX install failed: $($install.ExitCode); $evidence"}
foreach($entry in $previousRad){Remove-ItemProperty -LiteralPath $radKey -Name $entry.Name}
$bpl=Join-Path $release 'core\adapters\radstudio\Win64\PiAgent370.bpl'
New-ItemProperty -LiteralPath $radKey -Name $bpl -Value 'PiAgent acceptance (View + Tools)' -PropertyType String | Out-Null
$receipt.Release=$release
$receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $receiptPath -Encoding utf8
@{Release=$release;Evidence=$evidence;Vsix=$vsix;Bpl=$bpl;Omp=$settings.omp;Node=$settings.node;SignedInstallerCreated=$false} | ConvertTo-Json | Tee-Object -FilePath (Join-Path $evidence 'deployment.json')
