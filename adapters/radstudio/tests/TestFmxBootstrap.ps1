param([Parameter(Mandatory)][string]$FixtureRoot)
$ErrorActionPreference='Stop'
$fixturePath=[IO.Path]::GetFullPath($FixtureRoot)
if(([IO.File]::ReadAllText((Join-Path $fixturePath '.piagent-rad-fixture'))).Trim() -ne 'piagent-rad-fixture-v1'){throw 'Explicit prepared FMX fixture required'}
if(-not(Test-Path -LiteralPath (Join-Path $fixturePath 'Main.fmx'))){throw 'An FMX resource is required'}
$controlRoot=Join-Path $fixturePath 'runtime-control'
if(Test-Path -LiteralPath $controlRoot){throw 'Preserve previous runtime-control evidence; use a fresh fixture'}
$bdsRoot='C:\Program Files (x86)\Embarcadero\Studio\37.0'
$msbuild=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\MSBuild.exe'
$source=[IO.File]::ReadAllText((Join-Path $fixturePath 'Fixture.dpr'))
$results=[Collections.Generic.List[object]]::new()
foreach($variant in 'conventional','resource_only','no_show_only'){
 $directory=Join-Path $controlRoot $variant
 New-Item -ItemType Directory -Path $directory -Force | Out-Null
 foreach($file in 'Main.pas','Main.fmx','Fixture.dproj','Fixture.res'){Copy-Item -LiteralPath (Join-Path $fixturePath $file) -Destination $directory}
 $program=$source
 if($variant -ne 'no_show_only'){$program=$program.Replace("`r`nbegin", "`r`n{`$R *.res}`r`n`r`nbegin")}
 if($variant -ne 'resource_only'){$program=$program.Replace("  MainForm.Show;`r`n",'')}
 [IO.File]::WriteAllText((Join-Path $directory 'Fixture.dpr'),$program,[Text.UTF8Encoding]::new($false))
 $start=[Diagnostics.ProcessStartInfo]::new($msbuild)
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
 $start.WorkingDirectory=$directory;$start.Environment['BDS']=$bdsRoot
 foreach($argument in @((Join-Path $directory 'Fixture.dproj'),'/nologo','/v:minimal','/t:Build','/p:Config=Debug','/p:Platform=Win64',('/p:BDS='+$bdsRoot))){$start.ArgumentList.Add($argument)}
 $process=[Diagnostics.Process]::new();$process.StartInfo=$start
 try {
  if(-not $process.Start()){throw 'Cannot start installed MSBuild'}
  $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit(120000)){$process.Kill($true);$process.WaitForExit();throw 'Owned bootstrap build timed out'}
  [IO.File]::WriteAllText((Join-Path $directory 'build.log'),$stdout.GetAwaiter().GetResult()+$stderr.GetAwaiter().GetResult())
  if($process.ExitCode -ne 0){throw "Bootstrap variant failed compilation: $variant"}
  $exe=Join-Path $directory 'build\Fixture.exe'
  $results.Add([pscustomobject]@{variant=$variant;executable=$exe;sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant();built=$true})
 }finally{$process.Dispose()}
}
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $controlRoot 'results.json') -Encoding utf8
$results
