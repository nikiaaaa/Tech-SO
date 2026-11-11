"""Backup for the SQLite deployment: a consistent copy of the database (safe while the server runs) plus the evidence photos.

  cd TechSO/backend
  .\\venv\\Scripts\\python.exe ..\\scripts\\backup.py [--out ..\\backups] [--keep 14]

Schedule it with Windows Task Scheduler and copy the result off this machine. For PostgreSQL use pg_dump (docs/DEPLOYMENT.md).
Restore: stop the server, replace data/techso.db with the .db from the backup, unzip evidence.zip into the evidence directory.
"""
import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from app.config import settings  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path.cwd().parent / "backups"))
    ap.add_argument("--keep", type=int, default=14, help="number of most recent backups to keep")
    a = ap.parse_args()
    if not settings.database_url.startswith("sqlite:///"):
        sys.exit("This script handles SQLite only. Use pg_dump for PostgreSQL.")
    src = Path(settings.database_url.removeprefix("sqlite:///"))
    if not src.is_file():
        sys.exit(f"database not found: {src}")

    dest = Path(a.out) / datetime.now().strftime("%Y%m%d-%H%M%S")
    dest.mkdir(parents=True)
    with sqlite3.connect(src) as live, sqlite3.connect(dest / "techso.db") as copy:
        live.backup(copy)  # online backup API: consistent even with writers active
    check = sqlite3.connect(dest / "techso.db")
    ok = check.execute("PRAGMA integrity_check").fetchone()[0]
    jobs = check.execute("SELECT count(*) FROM jobs").fetchone()[0]
    check.close()
    if ok != "ok":
        sys.exit(f"backup failed the integrity check: {ok}")

    evidence = Path(settings.evidence_dir)
    files = sum(1 for p in evidence.rglob("*") if p.is_file()) if evidence.is_dir() else 0
    if files:
        shutil.make_archive(str(dest / "evidence"), "zip", evidence)

    old = sorted(p for p in Path(a.out).iterdir() if p.is_dir())[:-a.keep] if a.keep > 0 else []
    for p in old:
        shutil.rmtree(p)
    print(f"backup written to {dest}  (integrity ok, {jobs} jobs, {files} evidence files, removed {len(old)} old backups)")


if __name__ == "__main__":
    main()
