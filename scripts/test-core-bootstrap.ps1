[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$workspacePath=Split-Path $PSScriptRoot -Parent
$probe=Join-Path $workspacePath 'adapters/visualstudio/PiAgent.Transport.NetFx.Smoke/bin/Release/net472/PiAgent.Transport.NetFx.Smoke.exe'
$name='piagent-bootstrap-'+[guid]::NewGuid().ToString('N')
try {
    & $probe $name --bootstrap
    if($LASTEXITCODE -ne 0) { throw 'Cold Core bootstrap failed.' }
    & $probe $name --bootstrap
    if($LASTEXITCODE -ne 0) { throw 'Existing Core reconnect failed.' }
    Write-Output 'PASS cold Core start and existing Core reuse'
} finally {
    $processes=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine.Contains($name) -and $_.CommandLine -match 'PiAgent.+core\.mjs' }
    foreach($process in $processes) { Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
}
