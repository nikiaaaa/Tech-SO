# TechSO — Technical Service Operations

Field-service operations platform for ATM and CRM maintenance (part of the NEXUS OPS ecosystem).
Scheduler-assigned dispatch, SLA monitoring, live technician map, evidence-backed reports, performance scoring with appeals,
and a technician mobile app with offline support.

> **Demo data only.** Every company, bank, person, address and incident in this repository is fictional and labelled DEMO.
> Nothing here connects to a real bank or ATM system. Read the "What is and is not verified" section before relying on anything.

## Quick start (Windows, Python 3.12, Node 20+)

```powershell
.\scripts\setup.ps1             # venv, dependencies, migrations, demo data, npm install
.\scripts\start.ps1             # ONE process: API + built web app on http://127.0.0.1:8000  (technician app: /m)
```
For frontend development with hot reload use two terminals instead: `.\scripts\start-backend.ps1` and `.\scripts\start-frontend.ps1` (http://localhost:5173).
`.\scripts\start.ps1 -Lan -Cert cert.pem -Key key.pem` serves https on your network so phones can use GPS and the camera.

Demo accounts (password = `TECHSO_DEMO_PASSWORD`, default in `backend/.env.example`; demo use only):

| Role | Email | Use |
|---|---|---|
| Super Admin | `admin@demo.techso.local` | users, settings, GPS policy, audit |
| Management | `manager@demo.techso.local` | read-only overview, performance, scoring versions, SLA policies |
| Supervisor | `supervisor@demo.techso.local` | dispatch, verification, SLA pause approval, appeals |
| Scheduler | `scheduler@demo.techso.local` | create/assign/reassign jobs, verify reports |
| Technician | `tech1@…`, `tech2@…` … `tech5@demo.techso.local` | technician app at `/m` |

Suggested demo walk-through: sign in as the scheduler → Overview → open a job → assign it (Dispatch) → open `/m` in another window as `tech3` → accept, travel, arrive, checklist, photos, report → back as the scheduler: verify and close → Reports/Performance show the effect.

## GPS: how to verify it really works
GPS is a browser capability and needs **https or localhost**.
1. Same PC: open `http://localhost:5173/m`, sign in as a technician, **Shift → Start shift**, allow location, press **Test my GPS**. The panel shows the fix, its accuracy and the last ping the *server confirmed*.
2. Phone: `.\scripts\start-frontend.ps1 -Https`, open `https://<PC LAN address>:5173/m`, accept the self-signed certificate warning, repeat the steps. Then watch **Live Operations** on the scheduler screen.
3. No device handy: `python scripts/simulate_gps.py --fleet tech1@demo.techso.local,tech2@demo.techso.local,tech3@demo.techso.local,tech4@demo.techso.local --password <demo password>` drives several technicians towards their jobs with *synthetic* positions through the real endpoint, so Live Operations and the dispatch distances fill up for a demo (this tests the server pipeline, not a phone's GPS chip).

Dispatch distances are straight-line; travel times use an urban heuristic (distance × 1.4 for roads, 25 km/h) and are labelled as estimates.

## Backups
`cd backend; .\venv\Scripts\python.exe ..\scripts\backup.py` makes a consistent copy of the SQLite database (safe while running, integrity-checked) plus a zip of the evidence photos, keeping the last 14. Schedule it and copy the result off the machine.

## Repository layout
```
backend/   FastAPI app (app/api routers, app/services business rules, app/models, app/seed), Alembic migrations, tests
frontend/  React + Vite + Tailwind. src/pages/desktop (scheduler UI), src/pages/mobile (technician PWA), src/lib, src/components
docs/      ARCHITECTURE, API (generated), SECURITY (incl. GPS policy), DEPLOYMENT, TESTING, SCREEN-INVENTORY
scripts/   setup / start scripts, GPS simulator, API-doc generator
```
Docker files (`docker-compose.yml`, `*/Dockerfile`, `frontend/nginx.conf`) exist but are **untested**.
`../servicemax/` is the earlier ATM-monitor prototype; it is untouched and not used by TechSO.

## Modules
Operations Control Center · Job Dispatch · Live Field Operations · Technician management · ATM & CRM devices · SLA monitoring · Work evidence & reporting · Performance management · Reports & analytics · Notifications & escalation · Users/roles/organization · Settings, scoring versions, GPS policy, audit logs. Screen-by-screen mapping: `docs/SCREEN-INVENTORY.md`.

## Tests
See `docs/TESTING.md`. Backend: `cd backend; .\venv\Scripts\python.exe -m pytest`. Frontend: `cd frontend; npm run typecheck; npm test; npm run build`.

## What is and is not verified
Verified by automated tests (64 backend, 59 frontend): authentication, role permissions, tenant isolation, the job state machine, SLA states (incl. the clock restarting after a correction), SLA pause approval, escalation, offline-sync idempotency, GPS policy and validation, evidence validation, scoring and appeals, CSV export safety, WebSocket auth/origin, serving the web app from the API, migrations (upgrade/check/downgrade on SQLite).
Verified by hand in a browser against the running server: the full demo flow — create job (form validation), assign with GPS-based distances, technician accepts / travels / arrives / ticks the checklist / uploads before-after photos / submits the report on the mobile layout, scheduler approves, the score appears with its explanation.
**Not verified:** real phone GPS and camera hardware (photos were injected as files), notification sound/vibration, offline-to-online sync on a real device, PostgreSQL, Docker, behaviour behind a real reverse proxy, multi-worker operation.
**Not implemented:** Flutter/native Android app and FCM background push (the technician app is a PWA; alerts only while open), operating-hours/holiday SLA calendars, S3 storage, MFA, token revocation. Details and reasons: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`.

## Next steps
Native Android client + FCM · SLA calendars · PostgreSQL/Docker verification · Redis for hub/rate-limit with several workers · production tile provider · S3-compatible evidence storage · MFA and token revocation.
