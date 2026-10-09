[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$workspacePath=Split-Path $PSScriptRoot -Parent
$probe=Join-Path $workspacePath 'adapters/visualstudio/PiAgent.Transport.NetFx.Smoke/bin/Release/net472/PiAgent.Transport.NetFx.Smoke.exe'
$name='piagent-bootstrap-'+[guid]::NewGuid().ToString('N')
$logs=Join-Path $workspacePath ('artifacts/bootstrap-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $logs | Out-Null
function Invoke-Probe([string]$phase) {
    $output=Join-Path $logs ($phase+'.out.log')
    $errors=Join-Path $logs ($phase+'.err.log')
    # PowerShell's native pipeline can wait on handles inherited by the daemon.
    # Wait for this diagnostic process only, then clean our Core in finally.
    $process=Start-Process -FilePath $probe -ArgumentList @($name,'--bootstrap') -WindowStyle Hidden -PassThru -RedirectStandardOutput $output -RedirectStandardError $errors
    if (!$process.WaitForExit(30000)) { $process.Kill(); throw 'Bootstrap diagnostic timed out.' }
    Get-Content -LiteralPath $output
    if ($process.ExitCode -ne 0) { Get-Content -LiteralPath $errors; throw "Core $phase probe failed." }
}
try {
    & dotnet build (Join-Path $workspacePath 'adapters/visualstudio/PiAgent.Transport.NetFx.Smoke/PiAgent.Transport.NetFx.Smoke.csproj') -c Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap diagnostic build failed.' }
    Invoke-Probe 'cold'
    Invoke-Probe 'reconnect'
    Write-Output 'PASS cold Core start and existing Core reuse'
} finally {
    $processes=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine.Contains($name) -and $_.CommandLine -match 'PiAgent.+core\.mjs' }
    foreach($process in $processes) { Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
}
