[CmdletBinding()]
param([string]$NodeExecutable = 'node')
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This verification requires Windows Named Pipes.'
}
$workspacePath = Split-Path $PSScriptRoot -Parent
Push-Location $workspacePath
try {
    & dotnet build transport/PiAgent.PipeHost -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Secure pipe host build failed' }
    & $NodeExecutable -p 'process.version + " / " + process.arch'
    if ($LASTEXITCODE -ne 0) { throw 'Node runtime failed' }
    & $NodeExecutable node_modules/typescript/bin/tsc -b
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed' }
    & $NodeExecutable --test --test-concurrency=1 'tests/*.test.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
} finally { Pop-Location }
