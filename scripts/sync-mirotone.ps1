$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot "node_modules\\mirotone\\dist\\styles.css"
$targetDir = Join-Path $projectRoot "miro_app_frontend\\vendor"
$target = Join-Path $targetDir "mirotone.css"

if (-not (Test-Path $source)) {
  throw "mirotone stylesheet not found at $source"
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -Force $source $target
Write-Output "Copied mirotone stylesheet to $target"
