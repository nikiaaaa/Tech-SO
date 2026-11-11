# Run TechSO as ONE process on ONE port: the API also serves the built web app.
#   .\scripts\start.ps1            -> http://127.0.0.1:8000        (this PC only)
#   .\scripts\start.ps1 -Lan       -> reachable from phones on the same network (plain http: no GPS/camera on phones)
#   .\scripts\start.ps1 -Lan -Cert cert.pem -Key key.pem   -> https, so phones can use GPS and the camera
param([switch]$Lan, [string]$Cert, [string]$Key, [switch]$Rebuild)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if ($Rebuild -or -not (Test-Path "$root\frontend\dist\index.html")) {
  Write-Host "Building the web app..." -ForegroundColor Cyan
  Set-Location "$root\frontend"
  npm run build
}
Set-Location "$root\backend"
if ($Lan) { $env:TECHSO_HOST = "0.0.0.0" }
if ($Cert -and $Key) { $env:TECHSO_SSL_CERT = (Resolve-Path $Cert); $env:TECHSO_SSL_KEY = (Resolve-Path $Key) }
$scheme = if ($Cert -and $Key) { "https" } else { "http" }
Write-Host "TechSO: ${scheme}://127.0.0.1:8000   (technician app: /m)" -ForegroundColor Green
& .\venv\Scripts\python.exe run.py
