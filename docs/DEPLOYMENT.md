# Deployment

## Local (verified in this repository)
Windows, Python 3.12, Node 20+:

```powershell
.\scripts\setup.ps1            # venv, deps, migrations, demo data, npm install
.\scripts\start-backend.ps1    # http://127.0.0.1:8000
.\scripts\start-frontend.ps1   # http://localhost:5173
```

Database schema is managed by Alembic (`backend/migrations`): `alembic upgrade head`. In `dev` the app also creates missing tables on start for convenience; in `production` it does not.

## Real GPS on a phone
Browsers expose GPS only on **https** or `localhost`. To test on a phone in the same Wi-Fi:

```powershell
.\scripts\start-frontend.ps1 -Https     # self-signed certificate; accept the browser warning once
```
Open `https://<your PC LAN address>:5173/m` on the phone, sign in as a technician, start the shift, allow location. Check the **GPS diagnostics** panel on the Shift screen. A simulated route for the desktop map: `python scripts/simulate_gps.py --email tech2@demo.techso.local --password <demo password>`.

## Docker + PostgreSQL (NOT verified: Docker and PostgreSQL were not installed where this was built)
`docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf` are provided as a starting point:
```
copy .env.compose.example .env.compose   # edit the secrets
docker compose --env-file .env.compose up --build
```
Before relying on it: build the images, run `alembic upgrade head` against a real PostgreSQL, run the backend test-suite against PostgreSQL, and put a TLS-terminating reverse proxy in front of the `web` container.

## Production checklist
- `TECHSO_ENV=production`, a long random `TECHSO_SECRET_KEY`, `TECHSO_CORS_ORIGINS` set to your https origin.
- HTTPS everywhere (required for GPS, camera, service worker).
- One backend process until the WebSocket hub, rate limiter and login throttle are moved to a shared store (Redis).
- Evidence directory on a persistent, backed-up volume.
- Do **not** run `app.seed` (it refuses in production); create the first super admin through a one-off script or SQL and change its password.
- Map tiles: replace `tile.openstreetmap.org` in `frontend/src/components/MapView.tsx` with your own tile server/provider for sustained use (OSM tile usage policy).

## Backups
SQLite (default): `cd backend; .\venv\Scripts\python.exe ..\scripts\backup.py --out D:\techso-backups --keep 14` — online-consistent database copy with an integrity check, plus a zip of the evidence photos. Schedule it with Windows Task Scheduler (verified to run; restoring is described in the script header).

PostgreSQL (procedure, not automated):
```
pg_dump -Fc -h <host> -U techso techso > techso-$(date +%F).dump          # database
tar czf evidence-$(date +%F).tgz /srv/data/evidence                         # evidence photos
```
Schedule both (cron / your platform), keep copies off the host, and test a restore. GPS pings can be excluded from long-term backups: they expire per the retention policy.

## Monitoring / logging
Errors are logged with `logging` (no request bodies). `/health` is a liveness probe. Metrics and alerting are not included: add your platform's log shipping and an uptime check on `/health`.
