# TechSO architecture

TechSO is a **modular monolith**: one FastAPI service, one relational database, one React web app that serves both the
scheduler desktop UI and the technician mobile UI (installable PWA at `/m`). No microservices.

```
 Browser (desktop, /)        Phone (PWA, /m)
        │  REST + WebSocket        │  REST + WebSocket, offline queue (localStorage + IndexedDB)
        └────────────┬─────────────┘
                 FastAPI app  (app/main.py)
        api/  → thin routers, request validation (schemas.py)
        services/ → business rules, authorization, tenant scoping (the real logic)
        realtime.py → per-tenant WebSocket fan-out, events sent only after commit
                 SQLAlchemy 2 → SQLite (dev/tests) | PostgreSQL (target, not yet run here)
                 Evidence files → local directory (S3-compatible storage is a later step)
```

## Deviations from the recommended stack (and why)

| Spec recommendation | What was built | Reason / consequence |
|---|---|---|
| Node.js + NestJS | Python FastAPI + SQLAlchemy + Alembic | A working FastAPI stack and Python 3.12 toolchain already existed in the workspace; no reason to rewrite. Same modular-monolith shape. |
| Electron + React desktop | React web app (works in any browser) | Electron adds packaging only; the UI is already desktop-first. Wrap with Electron later if a native shell is needed. |
| Flutter Android | Installable React PWA (`/m`) | Flutter SDK is not installed in this environment, so a Flutter app could not be built or tested here. **Limits:** no FCM/background push, no Android notification channels, GPS and alerts only while the app is open. |
| Google Maps | Leaflet + OpenStreetMap tiles | Free, no API key. OSM's public tile server is for light use; production needs its own tile server or a provider. Needs a connection for tiles. |
| Firebase Cloud Messaging | In-app notifications over WebSocket + Web Audio/vibration/Notification API while the app is open | See above. Escalation to supervisors is server-side and works regardless. |
| PostgreSQL + Docker | PostgreSQL-portable schema, SQLite used for dev/tests; Docker files included | Docker and PostgreSQL are not installed here: the compose stack and Postgres path are **unverified**. |
| S3-compatible evidence storage | Local directory outside the web root, served through an authorized endpoint | Interface is isolated in `services/evidence.py`; swapping storage is contained. |

## Multi-tenancy and access

- Every operational row has `company_id`; the company is taken from the verified token, never from the request.
- `services.core.get_owned()` is the single primitive for "load by id within my company"; a row of another company is indistinguishable from a missing one (`404`).
- Roles: `super_admin`, `management`, `supervisor`, `scheduler`, `technician` (`app/security.py` `PERMISSIONS`). Authorization runs in the service layer (`require(user, "perm")`), not only in routers. Technicians additionally see only jobs currently assigned to them.
- Super Admin is the administrator **of one company** and cannot read another company's data.

## Job lifecycle (server-validated, `services/jobs.py`)

States: CREATED → ASSIGNED → NOTIFIED → ACCEPTED | REJECTED → EN_ROUTE → ARRIVED → IN_PROGRESS ⇄ ON_HOLD → RESOLVED → VERIFICATION → CLOSED, plus CANCELLED.

| Transition | Who | Rule |
|---|---|---|
| CREATED → ASSIGNED → NOTIFIED | scheduler/supervisor/super admin | technician must be an active technician of the same company; notification created |
| NOTIFIED → ACCEPTED / REJECTED | assigned technician | rejection needs a reason; rejection un-assigns the job and notifies dispatchers |
| any reassignable state → ASSIGNED | dispatch roles | reason mandatory; previous technician loses access |
| ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS | assigned technician | |
| IN_PROGRESS ⇄ ON_HOLD | assigned technician | reason code from a fixed list; `other` needs a note; **hold never pauses the SLA** |
| IN_PROGRESS → RESOLVED → VERIFICATION | assigned technician | notes ≥ 5 chars, valid resolution, ≥ 1 "after" photo (configurable) |
| VERIFICATION → CLOSED | dispatch roles | triggers performance scoring |
| VERIFICATION → IN_PROGRESS | dispatch roles | correction reason mandatory; report becomes version N+1 |
| non-terminal → CANCELLED | dispatch roles | reason mandatory |

Every transition writes a `job_events` row (with the device time `occurred_at` and the server receive time) and an `audit_logs` row, and recomputes `sla_tracking`.
If nobody answers a notified job within `accept_timeout_min`, the sweep (`escalation_sweep`, every 60 s and on demand) logs an escalation and notifies the configured roles once; it also re-reminds the technician every `repeat_interval_min`.

## SLA (`services/sla.py`, `services/sla_ops.py`)

- Targets come only from tenant-configured `sla_policies` (most specific match on bank / category / device type, per priority). If none matches, the job shows **"No SLA policy"**; nothing is assumed. The seed contains clearly named *demo* policies.
- Segments: dispatch, response, mobilization, travel, repair, verification, total. State per job = state of the total segment against `warning_pct`.
- Pause: a *request* with a documented reason, approved by a **different** supervisor/manager, audited; only approved pauses subtract time.
- When the scheduler sends a report back for correction, the job is no longer resolved: the total clock runs again until the next resolution.
- **Limits:** durations are wall-clock; operating hours and holidays are not applied yet. Live SLA is recomputed from events on read, batched (`compute_many`: three queries for up to 500 jobs), which is fine for thousands of open jobs; materialize if that grows further.

## Performance (`services/performance.py`)

Weights and parameters live in a versioned `scoring_versions` row (initial proposal 15/15/30/15/25, editable and publishable as a new version; old scores keep their version).
Adjustments applied and explained per job: excusable hold time (spare part, site access, connectivity, bank confirmation), overlapping assignments, travel distance (only when GPS data exists), checklist complexity. Dimensions with no SLA target are *not scored* and the weights renormalize. Technicians can appeal a score; a supervisor/manager decides; accepting records an override and keeps the original.
The ranking view states that it is not based on raw completion time.

## GPS (`services/gps.py`) — see SECURITY.md for the policy

Positions are accepted only from a technician with an active shift or an active assignment, validated, throttled and stored with their accuracy. Dispatch roles read the latest position (≤ 30 min old, stale flag after `stale_after_s`). Candidate distance is straight-line; the ETA applies a road factor (×1.4) at 25 km/h and is labelled as an estimate. A routing engine (e.g. self-hosted OSRM on OpenStreetMap data) is the upgrade path for real road times.

## Running it

`backend/run.py` serves the API and, when `frontend/dist` exists, the built web app from the same process and port (`scripts/start.ps1`), so a small deployment needs no separate web server. API routes always take precedence; unknown `/api/...` paths stay 404 and files outside `dist` are never served. Technician tokens last 12 h (a shift, often with poor signal); staff tokens 60 min.

## Offline sync (`services/sync.py`, frontend `lib/offline.ts`)

The device queues actions with a `client_id` and its own clock. `POST /sync` applies each action through the same state machine as live calls, one transaction per action, and stores a receipt so replays are idempotent. Refusals (e.g. job reassigned meanwhile) come back as `rejected` with the reason; the UI shows them as such and never as confirmed. Device time is honoured but never in the future and never earlier than the job's last event.

## Realtime

`realtime.Hub` keeps WebSocket connections per tenant. Services call `emit()`; events are queued on the DB session and only published **after commit** (dropped on rollback). Cross-site WebSocket hijacking is blocked by an Origin allow-list.
**Single-process only:** to run several workers, replace the in-memory hub with Redis pub/sub.

## Known limits / next steps

Flutter native app and FCM push · operating-hours/holiday SLA calendars · S3 storage and virus scanning for uploads · refresh-token rotation and revocation · MFA · shared-store rate limiting for multiple workers · PostgreSQL/Docker verification · map tile provider for production · automated backups and monitoring (documented in DEPLOYMENT.md, not automated).
