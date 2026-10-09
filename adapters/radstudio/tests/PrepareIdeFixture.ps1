param([ValidateSet('VCL','FMX')][string]$Framework='VCL',
 [ValidatePattern('^ide-dev(?:-[a-z0-9]+)?$')][string]$CandidateName='ide-dev', [switch]$Launch, [switch]$Autorun, [switch]$SdkAutorun,
 [ValidateRange(0,240)][int]$SoakMinutes=0,[switch]$CoreAutorun,[switch]$PreserveCandidateAssets)
$ErrorActionPreference='Stop'
$adapterRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$candidateRoot=Join-Path $adapterRoot "bin\Win64\$CandidateName"
$fixtureRoot=Join-Path $candidateRoot "sdk-fixture-$Framework"
$bdsRoot='C:\Program Files (x86)\Embarcadero\Studio\37.0'
$profileName="PiAgentSDKFixture$Framework"+$CandidateName.Replace('-','')
$profileRoot="HKCU:\Software\Embarcadero\$profileName\37.0"
function Copy-RegistryTree([Microsoft.Win32.RegistryKey]$Source,[Microsoft.Win32.RegistryKey]$Destination) {
  foreach($valueName in $Source.GetValueNames()) {
    $value=$Source.GetValue($valueName,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $Destination.SetValue($valueName,$value,$Source.GetValueKind($valueName))
  }
  foreach($subkeyName in $Source.GetSubKeyNames()) {
    $sourceChild=$Source.OpenSubKey($subkeyName)
    $destinationChild=$Destination.CreateSubKey($subkeyName)
    try { Copy-RegistryTree $sourceChild $destinationChild }
    finally { $destinationChild.Dispose(); $sourceChild.Dispose() }
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $candidateRoot 'PiAgent370.bpl'))) { throw 'Build the candidate Win64 BPL first' }
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $fixtureRoot '.piagent-rad-fixture'),'piagent-rad-fixture-v1',[Text.UTF8Encoding]::new($false))
$uses=if($Framework -eq 'VCL'){'Vcl.Forms'}else{'FMX.Forms'}
$unitUses=if($Framework -eq 'VCL'){'Vcl.Forms, Vcl.Controls, Vcl.StdCtrls'}else{'FMX.Forms, FMX.Types, FMX.Controls, FMX.StdCtrls'}
$resourceExt=if($Framework -eq 'VCL'){'dfm'}else{'fmx'}
$bootstrap=if($Framework -eq 'VCL'){'  Application.MainFormOnTaskbar := True;'}else{''}
$showMain=if($Framework -eq 'VCL'){'  MainForm.Show;'}else{''}
$files=@{
  'Fixture.dpr'="program Fixture;`r`n`r`nuses`r`n  $uses,`r`n  Main in 'Main.pas' {MainForm};`r`n`r`n{`$R *.res}`r`n`r`nbegin`r`n  Application.Initialize;`r`n$bootstrap`r`n  Application.CreateForm(TMainForm, MainForm);`r`n$showMain`r`n  Application.Run;`r`nend.`r`n"
  'Main.pas'="unit Main;`r`n`r`ninterface`r`n`r`nuses`r`n  System.Classes, $unitUses;`r`n`r`ntype`r`n  TMainForm = class(TForm)`r`n  private`r`n  public`r`n  end;`r`n`r`nvar`r`n  MainForm: TMainForm;`r`n`r`nimplementation`r`n`r`n{`$R *.$resourceExt}`r`n`r`nend.`r`n"
  "Main.$resourceExt"="object MainForm: TMainForm`r`n  Caption = 'PiAgent $Framework SDK Fixture'`r`n  ClientHeight = 300`r`n  ClientWidth = 500`r`nend`r`n"
  'Fixture.dproj'=@"
<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
 <PropertyGroup><ProjectGuid>{164670F3-9B93-446E-A111-C7D2C622C242}</ProjectGuid><MainSource>Fixture.dpr</MainSource><ProjectName>Fixture</ProjectName><ProjectVersion>20.5</ProjectVersion><Base>True</Base><AppType>Application</AppType><FrameworkType>$Framework</FrameworkType><TargetedPlatforms>3</TargetedPlatforms><Config Condition="'`$(Config)'==''">Debug</Config><Platform Condition="'`$(Platform)'==''">Win64</Platform></PropertyGroup>
 <PropertyGroup Condition="'`$(Config)'=='Base' or '`$(Base)'!=''"><Base>true</Base></PropertyGroup>
 <PropertyGroup Condition="('`$(Platform)'=='Win32' and '`$(Base)'=='true') or '`$(Base_Win32)'!=''"><Base_Win32>true</Base_Win32><CfgParent>Base</CfgParent><Base>true</Base></PropertyGroup>
 <PropertyGroup Condition="('`$(Platform)'=='Win64' and '`$(Base)'=='true') or '`$(Base_Win64)'!=''"><Base_Win64>true</Base_Win64><CfgParent>Base</CfgParent><Base>true</Base></PropertyGroup>
 <PropertyGroup Condition="'`$(Config)'=='Debug' or '`$(Cfg_1)'!=''"><Cfg_1>true</Cfg_1><CfgParent>Base</CfgParent><Base>true</Base></PropertyGroup>
 <PropertyGroup Condition="('`$(Platform)'=='Win32' and '`$(Cfg_1)'=='true') or '`$(Cfg_1_Win32)'!=''"><Cfg_1_Win32>true</Cfg_1_Win32><CfgParent>Cfg_1</CfgParent><Cfg_1>true</Cfg_1><Base>true</Base></PropertyGroup>
 <PropertyGroup Condition="('`$(Platform)'=='Win64' and '`$(Cfg_1)'=='true') or '`$(Cfg_1_Win64)'!=''"><Cfg_1_Win64>true</Cfg_1_Win64><CfgParent>Cfg_1</CfgParent><Cfg_1>true</Cfg_1><Base>true</Base></PropertyGroup>
 <PropertyGroup Condition="'`$(Base)'!=''"><DCC_Namespace>System;Winapi;Vcl;FMX;Data</DCC_Namespace><DCC_ExeOutput>build</DCC_ExeOutput><DCC_DcuOutput>build</DCC_DcuOutput></PropertyGroup>
 <PropertyGroup Condition="'`$(Cfg_1)'!=''"><DCC_Define>DEBUG;`$(DCC_Define)</DCC_Define><DCC_DebugInformation>1</DCC_DebugInformation><DCC_LocalDebugSymbols>true</DCC_LocalDebugSymbols><DCC_Optimize>false</DCC_Optimize></PropertyGroup>
 <ItemGroup><DelphiCompile Include="Fixture.dpr"><MainSource>MainSource</MainSource></DelphiCompile><DCCReference Include="Main.pas"><Form>MainForm</Form><FormType>$Framework.Form</FormType></DCCReference><BuildConfiguration Include="Debug"><Key>Cfg_1</Key><CfgParent>Base</CfgParent></BuildConfiguration></ItemGroup>
 <ProjectExtensions><Borland.Personality>Delphi.Personality.12</Borland.Personality><BorlandProject><Delphi.Personality><Source><Source Name="MainSource">Fixture.dpr</Source></Source></Delphi.Personality><Platforms><Platform value="Win32">False</Platform><Platform value="Win64">True</Platform></Platforms></BorlandProject></ProjectExtensions>
 <Import Project="`$(BDS)\Bin\CodeGear.Delphi.Targets"/>
</Project>
"@
}
# Keep a failed acceptance's source/resource available for review and recovery.
foreach($name in $files.Keys){$target=Join-Path $fixtureRoot $name;if(-not(Test-Path -LiteralPath $target)){[IO.File]::WriteAllText($target,$files[$name],[Text.UTF8Encoding]::new($false))}}
$testRoot=Join-Path $fixtureRoot 'dunitx'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures\DUnitXFixture.dpr') -Destination $testRoot -Force
$testProject=$files['Fixture.dproj'].Replace('Fixture.dpr','DUnitXFixture.dpr').Replace('<ProjectName>Fixture</ProjectName>','<ProjectName>DUnitXFixture</ProjectName>').Replace('<AppType>Application</AppType>','<AppType>Console</AppType>').Replace("<FrameworkType>$Framework</FrameworkType>",'<FrameworkType>None</FrameworkType>')
$testProject=$testProject.Replace('{164670F3-9B93-446E-A111-C7D2C622C242}',([guid]::NewGuid().ToString('B').ToUpperInvariant()))
$testProject=[regex]::Replace($testProject,'<DCCReference Include="Main.pas">.*?</DCCReference>','')
[IO.File]::WriteAllText((Join-Path $testRoot 'DUnitXFixture.dproj'),$testProject,[Text.UTF8Encoding]::new($false))
$candidateLoader=Join-Path $candidateRoot 'WebView2Loader.dll'
if(-not(Test-Path -LiteralPath $candidateLoader)){
  $packagePath=[IO.Path]::GetFullPath((Join-Path $adapterRoot '..\..\package.json'))
  $releaseVersion=([IO.File]::ReadAllText($packagePath)|ConvertFrom-Json).version
  if($releaseVersion -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$'){throw 'Current package version is invalid'}
  $releaseLoader=Join-Path $adapterRoot "bin\Win64\$releaseVersion\WebView2Loader.dll"
  if(-not(Test-Path -LiteralPath $releaseLoader)){throw 'Current release WebView2Loader or pre-copied candidate loader is required'}
  Copy-Item -LiteralPath $releaseLoader -Destination $candidateLoader
}
$uiSource=[IO.Path]::GetFullPath((Join-Path $adapterRoot '..\..\ui\src'))
if(-not(Test-Path -LiteralPath (Join-Path $uiSource 'chat.html'))){throw 'Current workspace UI assets are unavailable'}
$candidateUi=Join-Path $candidateRoot 'ui'
$uiModules=@('bridge.js','controller.js','interactions.js','settings.js','contracts.js','account.js','roles.js','execution.js','git.js','i18n.js','messages.en.js')
if($PreserveCandidateAssets){
  foreach($asset in @('chat.html')+$uiModules){if(-not(Test-Path -LiteralPath (Join-Path $candidateUi $asset))){throw "Pre-copied candidate UI asset is missing: $asset"}}
}else{
  New-Item -ItemType Directory -Path $candidateUi -Force | Out-Null
  Get-ChildItem -LiteralPath $uiSource | Where-Object Extension -ne '.ts' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $candidateUi -Recurse -Force }
  $uiDist=Join-Path (Split-Path -Parent $uiSource) 'dist'
  foreach($module in $uiModules){Copy-Item -LiteralPath (Join-Path $uiDist $module) -Destination $candidateUi -Force}
}
if(-not(Test-Path -LiteralPath $profileRoot)){
  # PowerShell's registry Copy-Item lost the source key values in the prior
  # fixtures. Copy each typed value and subkey into the exact alternate root.
  $sourceProfile=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Embarcadero\BDS\37.0')
  if($null -eq $sourceProfile){throw 'The installed RAD Studio user profile is unavailable'}
  $destinationProfile=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Embarcadero\$profileName\37.0")
  try { Copy-RegistryTree $sourceProfile $destinationProfile }
  finally { $destinationProfile.Dispose(); $sourceProfile.Dispose() }
}
$packages=Join-Path $profileRoot 'Known Packages x64'
if(-not(Test-Path -LiteralPath $packages)){throw 'The isolated profile is missing its installed design package registry'}
$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Embarcadero\$profileName\37.0\Known Packages x64",$true)
$standardPackages=@('dclstd370.bpl','dclfmxstd370.bpl')
foreach($packageName in $standardPackages){
  $registered=$key.GetValueNames() | Where-Object {[IO.Path]::GetFileName($_) -ieq $packageName}
  if(-not $registered){throw "The isolated profile is missing installed standard package $packageName; prepare a fresh candidate profile"}
  if(-not(Test-Path -LiteralPath (Join-Path $bdsRoot "bin64\$packageName"))){throw "Installed package $packageName is unavailable"}
}
foreach($name in $key.GetValueNames()){if($name -match '(?i)PiAgent.*\.bpl$'){$key.DeleteValue($name,$false)}}
$key.SetValue((Join-Path $candidateRoot 'PiAgent370.bpl'),'PiAgent candidate SDK acceptance',[Microsoft.Win32.RegistryValueKind]::String)
$designPackageCount=$key.GetValueNames().Count
$key.Dispose()
$start=[Diagnostics.ProcessStartInfo]::new((Join-Path $bdsRoot 'bin64\bds.exe'))
$start.UseShellExecute=$false
$start.Arguments="-r$profileName -ns `"$(Join-Path $fixtureRoot 'Fixture.dproj')`""
$start.EnvironmentVariables['PIAGENT_RAD_FIXTURE_PATH']=$fixtureRoot
$start.EnvironmentVariables['PIAGENT_PIPE_NAME']='piagent-rad-sdk-fixture-'+$Framework.ToLowerInvariant()+'-'+$CandidateName
$start.EnvironmentVariables['PIAGENT_AUTH_FILE']=Join-Path $fixtureRoot 'private\security\token'
if($Autorun){$start.EnvironmentVariables['PIAGENT_RAD_FIXTURE_AUTORUN']='1'}
if($SdkAutorun){$start.EnvironmentVariables['PIAGENT_RAD_SDK_AUTORUN']='1'}
if($SoakMinutes -gt 0){$start.EnvironmentVariables['PIAGENT_RAD_SOAK_MINUTES']=[string]$SoakMinutes}
if($CoreAutorun){$start.EnvironmentVariables['PIAGENT_RAD_CORE_AUTORUN']='1'}
$start.WorkingDirectory=$fixtureRoot
if($Launch){$process=[Diagnostics.Process]::Start($start);[pscustomobject]@{profile=$profileName;fixture=$fixtureRoot;pid=$process.Id;results=(Join-Path $fixtureRoot 'designer-acceptance.json')}}
else{[pscustomobject]@{profile=$profileName;fixture=$fixtureRoot;designPackageCount=$designPackageCount;launch="& '$PSCommandPath' -Framework $Framework -CandidateName $CandidateName -Launch";results=(Join-Path $fixtureRoot 'designer-acceptance.json')}}
