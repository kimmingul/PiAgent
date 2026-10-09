[CmdletBinding()]
param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path $PSScriptRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $workspacePath 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
if (!$OutputPath) { $OutputPath = Join-Path $workspacePath "dist/PiAgent-Documentation-$version.zip" }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw 'Refusing to overwrite an existing documentation archive.' }
$stage = Join-Path $workspacePath ('artifacts/documentation-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'website') -Force | Out-Null
foreach ($name in @('README.md','README.en.md','ARCHITECTURE.md','PROTOCOL.md')) {
    Copy-Item -LiteralPath (Join-Path $workspacePath $name) -Destination (Join-Path $stage $name)
}
Copy-Item -LiteralPath (Join-Path $workspacePath 'docs') -Destination (Join-Path $stage 'docs') -Recurse
Copy-Item -LiteralPath (Join-Path $workspacePath 'website/README.md') -Destination (Join-Path $stage 'website/README.md')
# Guides and diagrams stay usable offline. Source-code links point to the exact
# release tag instead of becoming broken relative paths in a docs-only archive.
foreach ($file in Get-ChildItem -LiteralPath $stage -Filter '*.md' -Recurse -File) {
    $relative = [IO.Path]::GetRelativePath($stage, $file.FullName)
    $sourceDirectory = Split-Path (Join-Path $workspacePath $relative) -Parent
    $text = Get-Content -LiteralPath $file.FullName -Raw
    $text = [regex]::Replace($text, '\]\(([^)]+)\)', {
        param($match)
        $link = $match.Groups[1].Value
        if ($link -match '^[a-z]+:|^#') { return $match.Value }
        $parts = $link.Split('#', 2)
        $decoded = [Uri]::UnescapeDataString($parts[0])
        $local = [IO.Path]::GetFullPath((Join-Path $file.DirectoryName $decoded))
        if ($local.StartsWith($stage + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $local)) { return $match.Value }
        $source = [IO.Path]::GetFullPath((Join-Path $sourceDirectory $decoded))
        if (!$source.StartsWith($workspacePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $source)) { throw "Unresolved documentation link: $relative -> $link" }
        $repoPath = [IO.Path]::GetRelativePath($workspacePath, $source).Replace('\','/')
        $urlPath = ($repoPath.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
        $anchor = if ($parts.Length -eq 2) { '#' + $parts[1] } else { '' }
        $kind = if (Test-Path -LiteralPath $source -PathType Container) { 'tree' } else { 'blob' }
        return "](https://github.com/kimmingul/PiAgent/$kind/v$version/$urlPath$anchor)"
    })
    [IO.File]::WriteAllText($file.FullName, $text, [Text.UTF8Encoding]::new($false))
}
New-Item -ItemType Directory -Path (Split-Path $OutputPath -Parent) -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $OutputPath)
$archive = [IO.Compression.ZipFile]::OpenRead($OutputPath)
try {
    if (!$archive.GetEntry('README.md') -or !$archive.GetEntry('README.en.md') -or !$archive.GetEntry('docs/images/setup-flow.en.svg') -or !$archive.GetEntry('docs/images/setup-flow.ko.svg')) { throw 'Incomplete documentation archive.' }
    $entries = $archive.Entries.Count
} finally { $archive.Dispose() }
@{path=$OutputPath;version=$version;entries=$entries;sha256=(Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash;stage=$stage} | ConvertTo-Json
