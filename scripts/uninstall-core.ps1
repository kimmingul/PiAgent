[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$receipt = Get-Content -LiteralPath (Join-Path $target 'install-receipt.json') -Raw | ConvertFrom-Json
if ($receipt.product -ne 'PiAgent' -or $receipt.version -notmatch '^\d+\.\d+\.\d+$' -or $receipt.path -ne $target -or (Split-Path $target -Leaf) -ne $receipt.version) { throw 'Installation receipt does not match target' }
if ($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\')) { throw 'Cannot remove a volume root' }
$current = $target
while ($current) {
    if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation paths are refused' }
    $current = [IO.Path]::GetDirectoryName($current)
}
foreach ($item in (Get-ChildItem -LiteralPath $target -Recurse -Force)) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked installation content is refused' }
}
# Only this verified version directory is removed; credentials and sessions live elsewhere.
Remove-Item -LiteralPath $target -Recurse -Force
Write-Output "Removed PiAgent $($receipt.version). Credentials and saved sessions are retained."
