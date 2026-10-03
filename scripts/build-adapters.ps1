[CmdletBinding()]
param([string]$MsBuildPath, [string]$BdsRoot)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
if (-not $MsBuildPath) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $vsRoot = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -property installationPath
    if (-not $vsRoot) { throw 'Visual Studio MSBuild is required.' }
    $MsBuildPath = Join-Path $vsRoot 'MSBuild\Current\Bin\MSBuild.exe'
}
if (-not $BdsRoot) {
    $installed = Get-ItemProperty HKCU:\Software\Embarcadero\BDS\* -ErrorAction SilentlyContinue |
        Where-Object RootDir | Sort-Object { [version]$_.PSChildName }
    $BdsRoot = ($installed | Select-Object -Last 1).RootDir
    if (-not $BdsRoot) { throw 'RAD Studio is required. Specify -BdsRoot.' }
}
Push-Location $workspacePath
try {
    & dotnet build adapters/visualstudio/PiAgent.Transport.Smoke/PiAgent.Transport.Smoke.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw 'C# transport build failed' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Core/UI TypeScript build failed' }
    & $MsBuildPath adapters/visualstudio/PiAgent.Vsix/PiAgent.Vsix.csproj /restore /t:Rebuild /p:Configuration=Release /v:minimal /nologo
    if ($LASTEXITCODE -ne 0) { throw 'VSIX build failed' }
    foreach ($platform in @('Win32', 'Win64')) {
        $compilerName = if ($platform -eq 'Win32') { 'dcc32.exe' } else { 'dcc64.exe' }
        $compiler = Join-Path $BdsRoot "bin\$compilerName"
        $output = Join-Path $workspacePath "adapters\radstudio\bin\$platform"
        New-Item -ItemType Directory -Path $output -Force | Out-Null
        Push-Location adapters/radstudio/src
        try {
            & $compiler -B -Q "-U$(Join-Path $BdsRoot "lib\$platform\release")" "-N0$output" "-LE$output" "-LN$output" PiAgent.dpk
            if ($LASTEXITCODE -ne 0) { throw "$platform BPL build failed" }
        } finally { Pop-Location }
        Push-Location adapters/radstudio/tests
        try {
            & $compiler -B -Q "-U$(Join-Path $BdsRoot "lib\$platform\release")" "-N0$output" "-E$output" PipeSmoke.dpr
            if ($LASTEXITCODE -ne 0) { throw "$platform transport smoke build failed" }
        } finally { Pop-Location }
    }
} finally { Pop-Location }
