$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\backend"
& .\venv\Scripts\python.exe run.py
