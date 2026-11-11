# Testing

## Commands
```powershell
cd backend;  .\venv\Scripts\python.exe -m pytest -q          # API, rules, security (in-memory SQLite)
cd frontend; npm run typecheck                                # tsc -b --noEmit
cd frontend; npm test                                         # vitest (jsdom)
cd frontend; npm run build                                    # production bundle
```
Migrations: `cd backend; $env:TECHSO_DATABASE_URL="sqlite:///./tmp.db"; alembic upgrade head; alembic check; alembic downgrade base`.

## Backend suites (`backend/tests`)
| File | Covers |
|---|---|
| `test_authz_tenancy.py` | login errors, lockout, rate limit, role matrix, technician row-level access, cross-tenant 404s on every resource, evidence validation/size/access |
| `test_workflow.py` | happy path with audit + score, invalid transitions, reject/reassign, hold rules (hold does not pause SLA), correction loop, cancel, filters/search escaping, SLA states, no-policy honesty, SLA pause approval, escalation, offline sync idempotency/refusals/clock clamp, WebSocket auth + origin + push, events dropped on rollback |
| `test_gps.py` | tracking only with shift/assignment, ping validation/throttle/accuracy, who may read positions, tenant scoping, future timestamps, distance candidates, haversine, retention purge, policy disable |
| `test_admin_perf.py` | scoring explanation and versioning, excusable hold adjustment, appeals, user management and secret redaction in audit, deactivation, settings validation, SLA policy permissions, audit access, overview/reports numbers, CSV formula safety, device import |

## Frontend
Vitest covers the offline queue (ordering, batching, idempotent replay, rejection, persistence), the GPS tracker (throttle, secure-context, permission errors, "confirmed only when the server stored it"), and key UI pieces (reason-required dialogs, role-gated actions). See `src/**/*.test.ts(x)`.

## Not covered by automated tests
Real GPS hardware, camera/photo downscale (no canvas in jsdom), audio/vibration, visual layout in real browsers, PostgreSQL, Docker, load/performance. These need manual checks on a device.
