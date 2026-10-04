[CmdletBinding()]
param([string]$Settings)
$ErrorActionPreference = 'Stop'
if (-not $Settings) { $Settings = Join-Path (Split-Path $PSScriptRoot -Parent) 'settings.json' }
$config = Get-Content -LiteralPath $Settings -Raw | ConvertFrom-Json
$arguments = @((Join-Path (Split-Path $PSScriptRoot -Parent) 'core.mjs'),'--pipe',[string]$config.pipe)
if ($config.omp) { $arguments += @('--omp',[string]$config.omp) }
if ($config.workspace) { $arguments += @('--workspace',[string]$config.workspace,'--cwd',[string]$config.workspace) }
if ($config.allowWrites) { $arguments += '--allow-writes' }
& $config.node @arguments
if ($LASTEXITCODE -ne 0) { throw 'PiAgent Core stopped with an error' }
