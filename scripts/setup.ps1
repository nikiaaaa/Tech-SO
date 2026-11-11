# One-time local setup (Windows PowerShell). Needs Python 3.12 and Node 20+.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "== Backend ==" -ForegroundColor Cyan
Set-Location "$root\backend"
if (-not (Test-Path venv)) { py -3.12 -m venv venv }
& .\venv\Scripts\python.exe -m pip install -q -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Write-Host "Created backend\.env from .env.example" }
& .\venv\Scripts\python.exe -m alembic upgrade head
& .\venv\Scripts\python.exe -m app.seed

Write-Host "== Frontend ==" -ForegroundColor Cyan
Set-Location "$root\frontend"
npm install --no-audit --no-fund

Write-Host "`nDone. Start with scripts\start-backend.ps1 and scripts\start-frontend.ps1" -ForegroundColor Green
