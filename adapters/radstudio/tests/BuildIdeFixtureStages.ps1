param([Parameter(Mandatory)][string]$FixtureRoot,
 [ValidateSet('Win64','Win32')][string]$Platform='Win64')
$ErrorActionPreference='Stop'
$fixturePath=[IO.Path]::GetFullPath($FixtureRoot)
if(([IO.File]::ReadAllText((Join-Path $fixturePath '.piagent-rad-fixture'))).Trim() -ne 'piagent-rad-fixture-v1'){throw 'Explicit prepared RAD fixture required'}
$receipt=Get-Content -LiteralPath (Join-Path $fixturePath 'designer-acceptance.json') -Raw | ConvertFrom-Json
if(-not $receipt.passed){throw 'Native designer acceptance did not pass'}
$stageRoot=[IO.Path]::GetFullPath($receipt.stageRoot)
if(-not $stageRoot.StartsWith((Join-Path $fixturePath 'stages')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Stage directory escapes the owned fixture'}
$bdsRoot='C:\Program Files (x86)\Embarcadero\Studio\37.0'
$msbuild=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe'
if(-not(Test-Path -LiteralPath $msbuild)){$msbuild=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\MSBuild.exe'}
$results=[Collections.Generic.List[object]]::new()
foreach($stage in 'createComponent','setScalarProperty','setCollectionProperty','bindEvent','deleteComponent'){
  $directory=Join-Path $stageRoot $stage
  if($stage -eq 'setCollectionProperty' -and -not (Test-Path -LiteralPath $directory)){continue}
  $project=Join-Path $directory 'Fixture.dproj'
  $log=Join-Path $directory 'msbuild.log'
  $start=[Diagnostics.ProcessStartInfo]::new($msbuild)
  $start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $start.WorkingDirectory=$directory;$start.Environment['BDS']=$bdsRoot
  foreach($argument in @($project,'/nologo','/v:normal','/t:Build','/p:Config=Debug',("/p:Platform="+$Platform),('/p:BDS='+$bdsRoot),'/fileLogger',('/fileLoggerParameters:LogFile='+$log+';Encoding=UTF-8;Verbosity=normal'))){$start.ArgumentList.Add($argument)}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$start
  try{
    if(-not $process.Start()){throw 'Cannot start installed MSBuild'}
    $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(120000)){$process.Kill($true);$process.WaitForExit();throw 'Owned stage build timed out'}
    $output=$stdout.GetAwaiter().GetResult()+$stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $directory 'process-output.log'),$output)
    $executable=Join-Path $directory 'build\Fixture.exe'
    $passed=$process.ExitCode -eq 0 -and (Test-Path -LiteralPath $executable)
    $results.Add([pscustomobject]@{stage=$stage;passed=$passed;exitCode=$process.ExitCode;project=$project;executable=$executable;log=$log})
    if(-not $passed){throw "Generated designer stage failed to build: $stage ($log)"}
  }finally{$process.Dispose();$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stageRoot 'build-results.json') -Encoding utf8}
}
$results
