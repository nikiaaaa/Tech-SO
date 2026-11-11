"""Regenerates docs/API.md from the live FastAPI route table, so the endpoint list can never drift from the code.
Run from TechSO/backend:  .\\venv\\Scripts\\python.exe ..\\scripts\\gen_api_docs.py"""
import os
import sys
from pathlib import Path

os.environ.setdefault("TECHSO_DATABASE_URL", "sqlite:///:memory:")
sys.path.insert(0, str(Path.cwd()))
from app.main import app  # noqa: E402

HEAD = """# TechSO API

Base URL: `/api/v1`. JSON in, JSON out. Interactive OpenAPI docs: `/docs` (only when `TECHSO_ENV` is not `production`).
This table is generated from the running code by `scripts/gen_api_docs.py`.

## Conventions
- **Auth:** `Authorization: Bearer <access_token>` from `POST /auth/login`. Tokens expire (default 60 min); `POST /auth/refresh` issues a new one.
- **Tenancy:** the company comes from the token, never from the request. A row of another company behaves exactly like a missing row (`404`).
- **Errors:** `401` not signed in, `403` role not allowed, `404` not found (or other tenant), `409` invalid state transition, `422` validation, `423` account locked, `429` rate limit. Body: `{"detail": "..."}`.
- **Job status changes** are validated by the server (see ARCHITECTURE.md, "Job lifecycle"). `RESOLVED` is never final: `VERIFICATION` then scheduler approval is required for `CLOSED`.
- **Offline sync:** `POST /sync` accepts an ordered batch of technician actions, each with a unique `client_id` (idempotent) and the device time in `occurred_at`. The response states per action `confirmed` or `rejected`.
- **Location:** `POST /me/location` is accepted only for a technician with an active shift or an authorized assignment; it is readable only through `/technicians/live` and `/technicians` by dispatch/management roles.
- **WebSocket:** `/ws?token=<access_token>` pushes `job.created`, `job.updated`, `assignment.new`, `assignment.removed`, `location.update`, `notification`. Events are hints to refetch.

## Endpoints
| Method | Path | Handler |
|---|---|---|
"""

rows = []
for r in app.routes:
    path = getattr(r, "path", "")
    if not path.startswith("/api/v1") and path not in ("/health", "/ws"):
        continue
    methods = sorted(getattr(r, "methods", None) or ["WS"])
    methods = [m for m in methods if m not in ("HEAD", "OPTIONS")]
    doc = (getattr(getattr(r, "endpoint", None), "__doc__", "") or "").strip().splitlines()
    rows.append((path, ", ".join(methods), getattr(getattr(r, "endpoint", None), "__name__", ""), doc[0] if doc else ""))

out = HEAD
for path, methods, name, doc in sorted(rows):
    out += f"| {methods} | `{path.replace('/api/v1', '')}` | {name}{(' — ' + doc) if doc else ''} |\n"

Path(__file__).resolve().parent.parent.joinpath("docs", "API.md").write_text(out, encoding="utf-8")
print(f"wrote {len(rows)} routes")
