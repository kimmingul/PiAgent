[CmdletBinding()]
param([string]$Path = (Join-Path $PSScriptRoot '../dist/PiAgent-Setup-0.9.20.exe'))
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $workspacePath ('artifacts/setup-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$setup = (Resolve-Path -LiteralPath $Path).Path
$signature = Get-AuthenticodeSignature -LiteralPath $setup
if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate -or $signature.SignerCertificate.Thumbprint -ne '3CE49DE1124F325082FA90BDE4944756D1626251') { throw 'Invalid setup signature/timestamp.' }
function Invoke-Setup([string[]]$Arguments) {
    $process = Start-Process -FilePath $setup -ArgumentList $Arguments -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Setup diagnostic failed ($($process.ExitCode)); see TEMP/PiAgent-setup-error.txt" }
}
$inspection = Join-Path $testRoot 'detection.json'
Invoke-Setup @('--inspect',('"'+$inspection+'"'))
Write-Host (Get-Content -LiteralPath $inspection -Raw)
$payload = Join-Path $testRoot 'extracted'
Invoke-Setup @('--verify-payload',('"'+$payload+'"'))
Write-Host 'PASS signed setup / complete embedded payload hashes'
$previousPath = $env:PATH
try {
    foreach ($arch in @('arm64','x64')) {
        if ($arch -eq 'arm64' -and [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE','Machine') -ne 'ARM64') { continue }
        $env:PATH = (Join-Path $payload "runtimes/$arch/dotnet")+';'+$previousPath
        & (Join-Path $payload "runtimes/$arch/node/node.exe") (Join-Path $PSScriptRoot 'test-installer-runtime.mjs') $payload
        if ($LASTEXITCODE -ne 0) { throw "Bundled $arch runtime failed." }
    }
} finally { $env:PATH = $previousPath }
& dotnet run --project (Join-Path $workspacePath 'installer/PiAgent.Setup.Tests') -c Release
if ($LASTEXITCODE -ne 0) { throw 'Installer safety tests failed.' }
Write-Host "Verification artifacts: $testRoot"
