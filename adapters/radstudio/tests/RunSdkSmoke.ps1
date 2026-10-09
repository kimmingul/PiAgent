param([ValidateSet('Win64','Win32')][string]$Platform='Win64')
$ErrorActionPreference='Stop'
$adapterRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bdsRoot='C:\Program Files (x86)\Embarcadero\Studio\37.0'
$compiler=Join-Path $bdsRoot ('bin\dcc'+$(if($Platform -eq 'Win64'){'64'}else{'32'})+'.exe')
$outputRoot=Join-Path $adapterRoot "bin\$Platform\sdk-smoke"
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$results=[Collections.Generic.List[object]]::new()
function Compile([string]$file,[string]$directory,[switch]$Package){
 $arguments=@('-B','-Q',('-U'+(Join-Path $bdsRoot "lib\$Platform\release")),('-N0'+$outputRoot),('-E'+$outputRoot))
 if($Package){$arguments+=@(('-LE'+$outputRoot),('-LN'+$outputRoot))}
 Push-Location $directory
 try{$log=& $compiler @arguments $file 2>&1;$code=$LASTEXITCODE}
 finally{Pop-Location}
 [IO.File]::WriteAllLines((Join-Path $outputRoot ($file+'.compile.log')),[string[]]$log)
 if($code -ne 0){throw "SDK compilation failed: $file (see $outputRoot)"}
}
Compile 'PiAgent.dpk' (Join-Path $adapterRoot 'src') -Package
Compile 'DUnitXFixture.dpr' (Join-Path $PSScriptRoot 'fixtures')
$externalRoot=Join-Path $outputRoot 'external-fixture'
New-Item -ItemType Directory -Path $externalRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures\ExternalBuildFixture.dpr') -Destination $externalRoot -Force
$project=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fixtures\ExternalBuildFixture.dproj'))
$project=$project.Replace('..\..\bin\$(Platform)\ide-dev\external-fixture','bin')
[IO.File]::WriteAllText((Join-Path $externalRoot 'ExternalBuildFixture.dproj'),$project,[Text.UTF8Encoding]::new($false))
foreach($test in @('EditorOffsetsSmoke','OwnedProcessSmoke','ExternalBuildSmoke','DesignerJournalSmoke','DesignerPropertiesSmoke','DesignerRelationsSmoke','DUnitXRunnerSmoke','ProcessCpuSmoke','RequestRetirementSmoke','DesignerAuthoringGuardsSmoke')){
 Compile ($test+'.dpr') $PSScriptRoot
 $arguments=@()
 if($test -eq 'ExternalBuildSmoke'){$arguments=@((Join-Path $externalRoot 'ExternalBuildFixture.dproj'),$bdsRoot)}
 if($test -eq 'DUnitXRunnerSmoke'){$arguments=@((Join-Path $outputRoot 'DUnitXFixture.exe'))}
 $log=& (Join-Path $outputRoot ($test+'.exe')) @arguments 2>&1
 $code=$LASTEXITCODE
 [IO.File]::WriteAllLines((Join-Path $outputRoot ($test+'.run.log')),[string[]]$log)
 $results.Add([pscustomobject]@{test=$test;platform=$Platform;passed=($code -eq 0);output=($log -join "`n")})
 if($code -ne 0){$results|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $outputRoot 'results.json') -Encoding utf8;throw "SDK smoke failed: $test (see $outputRoot)"}
}
$results|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $outputRoot 'results.json') -Encoding utf8
"PASS ${Platform}: candidate BPL compile and $($results.Count) actual SDK smoke harnesses ($outputRoot\results.json)"
