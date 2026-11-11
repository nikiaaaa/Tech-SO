# Usage: start-frontend.ps1            -> http://localhost:5173
#        start-frontend.ps1 -Https     -> https on your LAN, needed for real GPS on a phone
param([switch]$Https)
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\frontend"
if ($Https) { npm run dev:https } else { npm run dev }
