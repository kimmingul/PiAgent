param()
$ErrorActionPreference='Stop'
$adapterRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureRoot=Join-Path $adapterRoot 'bin\Win64\cpp-toolchain-fixture'
$bdsRoot='C:\Program Files (x86)\Embarcadero\Studio\37.0'
$msbuild='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe'
New-Item -ItemType Directory -Path $fixtureRoot -Force|Out-Null
foreach($fileName in @('CppConsoleFixture.cpp','CppConsoleFixture.cbproj')) {
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot "fixtures\$fileName") -Destination (Join-Path $fixtureRoot $fileName) -Force
}
[IO.File]::WriteAllText((Join-Path $fixtureRoot '.piagent-rad-cpp-fixture'),'piagent-rad-cpp-fixture-v1')
$personalities=[Collections.Generic.List[object]]::new()
foreach($registryPath in @('HKCU:\Software\Embarcadero\BDS\37.0\Personalities','HKLM:\Software\WOW6432Node\Embarcadero\BDS\37.0\Personalities')) {
 if(Test-Path $registryPath){$personalities.Add([pscustomobject]@{path=$registryPath;names=@((Get-Item $registryPath).GetValueNames()|Where-Object {$_})})}
}
$compilerNames=@('bcc32.exe','bcc32c.exe','bcc64.exe','bcc64x.exe','clang.exe')
$compilers=@(foreach($directory in @('bin','bin64')){foreach($name in $compilerNames){$path=Join-Path $bdsRoot "$directory\$name";[pscustomobject]@{path=$path;exists=(Test-Path $path)}}})
$results=[Collections.Generic.List[object]]::new()
foreach($platform in @('Win32','Win64','Win64x')) {
 $stdout=Join-Path $fixtureRoot "$platform.stdout.log";$stderr=Join-Path $fixtureRoot "$platform.stderr.log"
 $arguments=@('CppConsoleFixture.cbproj','/t:Rebuild',"/p:BDS=`"$bdsRoot`"",'/p:Config=Debug',"/p:Platform=$platform",'/nologo','/verbosity:minimal','/maxcpucount:1','/nodeReuse:false')
 $process=Start-Process -FilePath $msbuild -ArgumentList $arguments -WorkingDirectory $fixtureRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Environment @{BDS=$bdsRoot;BDSBIN=(Join-Path $bdsRoot 'bin');BDSLIB=(Join-Path $bdsRoot 'lib');BDSINCLUDE=(Join-Path $bdsRoot 'include')}
 $completed=$process.WaitForExit(60000)
 if(-not $completed){Stop-Process -Id $process.Id -ErrorAction Stop}
 $results.Add([pscustomobject]@{platform=$platform;completed=$completed;exitCode=$process.ExitCode;stdout=$stdout;stderr=$stderr;success=($completed -and $process.ExitCode -eq 0)})
}
$hasCompiler=@($compilers|Where-Object exists).Count -gt 0
$hasCppPersonality=@($personalities|ForEach-Object names|Where-Object {$_ -match 'CPlusPlus|CBuilder|BCB'}).Count -gt 0
$receipt=[ordered]@{schemaVersion=1;capturedAt=[DateTimeOffset]::Now.ToString('o');fixture=$fixtureRoot;msbuild=$msbuild;cppTargetsPresent=(Test-Path (Join-Path $bdsRoot 'bin\CodeGear.Cpp.Targets'));compilers=$compilers;personalities=$personalities;hasCompiler=$hasCompiler;hasCppPersonality=$hasCppPersonality;licenseState='not_inspected';builds=$results;nativeIdeAcceptance='not_started';boundary=$(if(-not $hasCompiler -or -not $hasCppPersonality){'Local installation lacks C++Builder compiler/personality; native context/build/debug acceptance cannot be demonstrated here'}else{'CLI results recorded; native IDE acceptance requires a separately coordinated launch'})}
$receipt|ConvertTo-Json -Depth 7|Set-Content -LiteralPath (Join-Path $fixtureRoot 'cpp-toolchain.receipt.json') -Encoding utf8
$receipt|ConvertTo-Json -Depth 7
