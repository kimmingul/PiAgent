[CmdletBinding()]
param([string]$MsBuildPath, [string]$BdsRoot, [ValidateSet('Win32','Win64')][string[]]$RadPlatforms = @('Win64'), [switch]$SkipCodeSign)
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
    $releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
    & dotnet build transport/PiAgent.PipeHost -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Secure pipe host build failed' }
    & dotnet build adapters/visualstudio/PiAgent.Transport.Smoke/PiAgent.Transport.Smoke.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw 'C# transport build failed' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Core/UI TypeScript build failed' }
    $codeSign = if ($SkipCodeSign) { 'false' } else { 'true' }
    & $MsBuildPath adapters/visualstudio/PiAgent.Vsix/PiAgent.Vsix.csproj /restore /t:Rebuild /p:Configuration=Release "/p:PiAgentCodeSign=$codeSign" /v:minimal /nologo
    if ($LASTEXITCODE -ne 0) { throw 'VSIX build failed' }
    Push-Location adapters/radstudio/resources
    try {
        $resourceCompiler = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\rc.exe" |
            Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
        if (!$resourceCompiler) { throw 'Windows SDK resource compiler is required.' }
        & $resourceCompiler /fo PiAgentIcons.res PiAgentIcons.rc
        if ($LASTEXITCODE -ne 0) { throw 'Icon resource compilation failed' }
    } finally { Pop-Location }
    foreach ($platform in $RadPlatforms) {
        $compilerName = if ($platform -eq 'Win32') { 'dcc32.exe' } else { 'dcc64.exe' }
        $compiler = Join-Path $BdsRoot "bin\$compilerName"
        $output = Join-Path $workspacePath "adapters\radstudio\bin\$platform\$releaseVersion"
        New-Item -ItemType Directory -Path $output -Force | Out-Null
        Push-Location adapters/radstudio/src
        try {
            & $compiler -B -Q "-U$(Join-Path $BdsRoot "lib\$platform\release")" "-N0$output" "-LE$output" "-LN$output" PiAgent.dpk
            if ($LASTEXITCODE -ne 0) { throw "$platform BPL build failed" }
        } finally { Pop-Location }
        $uiOutput = Join-Path $output 'ui'
        New-Item -ItemType Directory -Path $uiOutput -Force | Out-Null
        Get-ChildItem -LiteralPath ui/src | Where-Object Extension -ne '.ts' | Copy-Item -Destination $uiOutput -Recurse -Force
        Copy-Item -LiteralPath ui/dist/bridge.js,ui/dist/controller.js,ui/dist/interactions.js -Destination $uiOutput -Force
        $loaderArch = if ($platform -eq 'Win32') { 'win-x86' } else { 'win-x64' }
        $loader = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.web.webview2\1.0.4258.31\runtimes\$loaderArch\native\WebView2Loader.dll"
        Copy-Item -LiteralPath $loader -Destination $output
        Push-Location adapters/radstudio/tests
        try {
            & $compiler -B -Q "-U$(Join-Path $BdsRoot "lib\$platform\release")" "-N0$output" "-E$output" PipeSmoke.dpr
            if ($LASTEXITCODE -ne 0) { throw "$platform transport smoke build failed" }
            & $compiler -B -Q "-U$(Join-Path $BdsRoot "lib\$platform\release")" "-N0$output" "-E$output" ChatSmoke.dpr
            if ($LASTEXITCODE -ne 0) { throw "$platform chat smoke build failed" }
        } finally { Pop-Location }
        if (!$SkipCodeSign) { & "$PSScriptRoot\sign-artifacts.ps1" -Directory $output }
    }
    if (!$SkipCodeSign) {
        & "$PSScriptRoot\sign-artifacts.ps1" -Directory 'transport/PiAgent.PipeHost/bin/Release'
        & "$PSScriptRoot\sign-vsix.ps1"
    }
} finally { Pop-Location }
