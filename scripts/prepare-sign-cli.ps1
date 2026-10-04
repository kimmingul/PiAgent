[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$source = Join-Path $workspacePath '.tools/sign-source'
$output = Join-Path $workspacePath '.tools/sign-x86'
$revision = '8e61df9fb776e0c2499dbed0b8037fe450da917b'
if (!(Test-Path -LiteralPath (Join-Path $source '.git'))) {
    & git clone https://github.com/dotnet/sign.git $source
    if ($LASTEXITCODE -ne 0) { throw 'Sign CLI source download failed.' }
    & git -C $source checkout --detach $revision
    if ($LASTEXITCODE -ne 0) { throw 'Sign CLI revision checkout failed.' }
}
if ((& git -C $source rev-parse HEAD) -ne $revision) { throw 'Unexpected Sign CLI source revision.' }
$program = Join-Path $source 'src/Sign.Cli/Program.cs'
$original = 'if (!Environment.Is64BitProcess)'
$compat = 'if (!Environment.Is64BitProcess && !(args.Length > 0 && args[^1].EndsWith(".vsix", StringComparison.OrdinalIgnoreCase)))'
$content = Get-Content -LiteralPath $program -Raw
if (!$content.Contains($compat)) {
    if (!$content.Contains($original)) { throw 'Unexpected Sign CLI architecture check.' }
    [IO.File]::WriteAllText($program, $content.Replace($original, $compat))
}
# Only OPC/VSIX container signing uses this source compatibility build. PE signing uses SDK SignTool.
& dotnet publish (Join-Path $source 'src/Sign.Cli/Sign.Cli.csproj') -c Release -r win-x86 /p:PlatformTarget=x86 /p:UseAppHost=false /p:UpdateXlfOnBuild=false /p:EnableXlfLocalization=false /p:EnableNGenOptimization=false -o $output
if ($LASTEXITCODE -ne 0) { throw 'x86 Sign CLI compatibility build failed.' }
@{revision=$revision;patch='Allow x86 only for a VSIX final argument; disable recursive container signing at invocation.'} | ConvertTo-Json | Set-Content (Join-Path $output 'source-revision.json')
