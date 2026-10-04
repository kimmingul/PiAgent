[CmdletBinding()]
param([string]$BdsRoot = 'C:\Program Files (x86)\Embarcadero\Studio\37.0')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $BdsRoot 'bin\dcc64.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Specify -BdsRoot for RAD Studio with the Win64 compiler.' }
$outputPath = Join-Path $workspacePath '.tools\gui-harness-smoke'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
foreach ($fixture in @(
    @{ Directory = 'adapters\radstudio\tests'; Program = 'DesignerRelationsSmoke' },
    @{ Directory = 'examples\fmx-document-editor'; Program = 'NativeEditorSmoke' }
)) {
    Push-Location (Join-Path $workspacePath $fixture.Directory)
    try {
        & $compiler -B -Q "-U$(Join-Path $BdsRoot 'lib\Win64\release')" "-N0$outputPath" "-E$outputPath" ($fixture.Program + '.dpr')
        if ($LASTEXITCODE -ne 0) { throw "$($fixture.Program) Win64 build failed" }
        & (Join-Path $outputPath ($fixture.Program + '.exe'))
        if ($LASTEXITCODE -ne 0) { throw "$($fixture.Program) assertions failed" }
    } finally { Pop-Location }
}
