# TechSO — Screen Inventory & Gap Analysis

## Implementation status (updated after the build)

Sections 1-2 below are the **original assessment of the earlier ServiceMAX prototype** (kept for history). Every screen in sections 4 and 5 now exists in `TechSO/frontend/src/pages/{desktop,mobile}`.

| Level of checking | Screens |
|---|---|
| Opened and used in a real browser against the running API | D00 login, D01 Overview, D02 Live Operations (map + real pings appearing live), D03 Dispatch, **D03a Create Job (validation + Create & Assign)**, D03b assignment with GPS distances, D04/D04a History and Job Detail (timeline, protected photos, approve & close), D05 Technicians, D06 Devices, D07 SLA, D08 Performance, D09 Reports, D10 Settings tabs (sla, users, scoring, audit, devices, gps, teams, notifications, general), D12 Notifications, **M00 login, M01 Home, M02 Incoming job, M03 Job details, M04 Navigation (OSM map), M05 Arrival, M06 Checklist, M07 Evidence upload (files injected), M08 Job report** — the full demo flow end to end |
| Compiled and unit-tested only (not clicked through) | reassign / cancel / correction / SLA-pause dialogs, Settings edit forms, team and shift editing, device add/edit, appeal decision form, M09 Performance, M10 Shift + GPS diagnostics, M11 Profile, M12 Sync queue, M13 reject/hold sheets |
| Not verifiable here | Real GPS fix on a phone, camera hardware, alert sound/vibration, offline-to-online sync on a device |

Server side, the GPS path was exercised end to end on a running server: technician with an active shift posts a position, the scheduler reads it from `/technicians/live`, a technician is refused (403).

Status: original assessment follows.
Source of truth: Master UI/UX Specification (TechSO). Visual direction: attached TechSO reference image.
Audited workspace: `D:\AA SMILEYY\AAAAA LEARNT\APPS serviceMAX`

## 1. What exists today (verified by reading the files)

| Area | Reality |
|---|---|
| Product | "ServiceMAX — ATM Central Monitor": reads ATM incident tables from bank web portals through a Chrome extension and shows them in a dashboard. Incident-centric, not job-centric. |
| Backend | FastAPI + SQLAlchemy + SQLite (WAL). Tables: `sources`, `incidents`, `incident_events`, `monitoring_sessions`, `audit_logs`. 15 pytest tests pass (event engine only). |
| Auth | One shared static API key (`X-API-Key`, default `change-me-on-first-run`). **No users, roles, tenants, JWT, or per-user audit.** |
| Frontend | React 18 + Vite 6 + Tailwind 3 + react-router + socket.io-client + lucide-react. **Dark theme** (`#111827`). 6 routes: Dashboard, Incidents, Sources, History, Reports, Settings. |
| Extension | Chrome MV3, scrapes bank portal tables (BANK_A/B/C adapters). |
| Mobile | **None.** No Android app, no responsive technician UI. |
| Maps / GPS / push / evidence upload / offline | **None.** |
| Docs | `docs/PHASE1-COMPLETE.md` only. No README, no API docs, no migrations (tables created by `create_all`). |
| Logo | `logo.webp` (1024x1024) at repo root: navy rounded-square "S" mark with wave and "TechSO" text, on light-grey background. Needs cropping/optimizing before use. |
| Skills | `Ponytails/skills/`: ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review. Ponytail "full" mode is already active. No GitHub skill exists in the folder. |
| Git | Not a git repository (no history, no safety net for rewrites). |
| Toolchain | Present: Node v26, Python 3.12 (+3.13, 3.14), Git, Java 21. **Missing: Flutter, Docker, PostgreSQL.** |

Open review findings from the earlier ponytail-review that are still **unfixed**: extractor re-sends all events on every DOM mutation; Beta/Gamma adapter cell guards too low; `unacknowledged` stat counts baseline rows; duplicate `active`/`unacknowledged` query; extension fingerprint omits `problem_code`; `/sources/{id}/status` accepts any string; missing extension icon files.

## 2. Gap summary vs. spec

- Spec data model has 20 entities; **3 loosely map** (`incidents`≈`jobs`, `incident_events`≈`job_events`, `audit_logs`). 17 are missing, incl. companies/banks/branches/users/roles/teams/shifts/devices/sla_policies/job_assignments/sla_tracking/location_pings/work_reports/job_evidence/performance_scores/notifications.
- Spec status lifecycle has 13 states; existing has 4 (`new|detected|acknowledged|resolved`) with no transition validation.
- Spec requires scheduler-assigned dispatch, SLA engine, scoring, GPS policy, offline sync, tenant isolation: **none implemented**.

## 3. Legend

Roles: **SA** Super Admin · **MG** Management · **SV** Supervisor · **SC** Scheduler/Dispatcher · **TK** Field Technician.
States: **L** loading · **E** empty · **X** error/retry · **F** forbidden · **V** validation error · **O** offline / sync state (local · pending · server-confirmed) · **S** success.
Existing: ✅ usable as-is · 🟡 partial/reusable pieces · ❌ none.
All endpoints are under `/api/v1`. "Tenant" = every query filtered by `company_id` from the token, never from the client.

## 4. Screen inventory — Desktop (Scheduler/Management)

| ID | Screen | Existing | Missing | Data deps | API deps | Roles | Interactive actions | States |
|---|---|---|---|---|---|---|---|---|
| D00 | Login & session | ❌ | Everything: login form, JWT/refresh, lockout, logout, session expiry | users, roles, companies | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | all | Sign in, sign out, switch company (SA only) | L X V F |
| D01 | Overview (Operations Control Center) | 🟡 `Dashboard.tsx`: 4 incident stat cards + table, dark theme | 9 spec KPIs (active, unassigned, awaiting acceptance, techs available/working, SLA warn/breach, resolved, critical), priority donut, SLA performance ring, recent activity feed, date-range filter | jobs, job_events, sla_tracking, users(shift), notifications | `GET /overview?range=`, WebSocket `job.*` | SA MG SV SC | Change range, click KPI → filtered Job Dispatch, click activity → job detail | L E X |
| D02 | Live Operations | ❌ | 3-column layout, map with technician + job markers, live toggle, priority/status/team filters, selected-job panel, contact technician, view report | jobs, job_assignments, location_pings, users, atm_devices | `GET /jobs?…`, `GET /technicians/live`, WS `location.update`, `job.updated` | SC SV MG | Select job, toggle live, filter, assign/reassign, contact, open evidence | L E X O |
| D03 | Job Dispatch (queue) | ❌ | Unassigned/active queue, priority tabs (All/High/Medium/Low), per-row Assign, SLA countdown | jobs, sla_tracking | `GET /jobs`, `GET /jobs/{id}` | SC SV | Filter, sort, paginate, assign, open detail | L E X F |
| D03a | Create Job modal | ❌ | Form: device (ATM/CRM) select, incident category, priority, description; SLA deadline preview; "Create & Assign" | atm_devices, incident_categories, sla_policies | `POST /jobs`, `GET /devices`, `GET /incident-categories`, `POST /sla/preview` | SC SV | Create, create & assign, cancel | V X S |
| D03b | Assign / Reassign panel | ❌ | Recommended-technician list: availability, location (if permitted), distance, ETA, workload, skills, active assignments; manual final choice; reassign reason | users, shifts, location_pings, job_assignments, skills | `GET /jobs/{id}/candidates`, `POST /jobs/{id}/assign`, `POST /jobs/{id}/reassign` | SC SV | Assign, reassign (reason mandatory), cancel | L E V X |
| D04 | Job History | 🟡 `History.tsx`: incident search table (ATM, source, desc, priority, status, dates) | Job-based columns, filters (date/bank/status/tech/SLA), sorting, pagination, export | jobs, job_events | `GET /jobs?status=&from=&to=&q=&page=` | SA MG SV SC | Search, filter, sort, paginate, open detail, export | L E X |
| D04a | Job Detail + Timeline | 🟡 `IncidentDetail.tsx` (fields + ack/resolve) | Full lifecycle timeline, assignment history, SLA segments, evidence, report, notes, actions per status | jobs, job_events, job_assignments, sla_tracking, work_reports, job_evidence | `GET /jobs/{id}`, `GET /jobs/{id}/events`, status endpoints (see §6) | SC SV MG (read: TK own) | Cancel, reassign, request correction, approve & close | L X F |
| D05 | Technicians | ❌ | List, status (available/working/busy/off-shift), team, skills, workload, shift; detail panel | users, teams, team_members, shifts, job_assignments | `GET /technicians`, `GET /technicians/{id}` | SC SV MG SA | Search, filter, open detail, contact | L E X |
| D05a | Technician detail & shift | ❌ | Profile, today's jobs, shift schedule, performance summary | users, shifts, performance_scores | `GET /technicians/{id}/shifts`, `POST /shifts` | SV SA (edit) | Edit shift, view score | L X V |
| D06 | ATM & CRM Devices | 🟡 `Sources.tsx` lists monitored *portals*, not devices | Device registry: ID, type (ATM/CRM), bank, branch, address, status, last incident | atm_devices, banks, branches | `GET /devices`, `GET/PATCH /devices/{id}` | SC SV SA | Search, filter, open, add/edit device | L E X V |
| D06a | Device detail | ❌ | Incident history, open jobs, location, SLA policy applied | atm_devices, jobs | `GET /devices/{id}/jobs` | SC SV MG | View, create job for device | L E X |
| D07 | SLA Monitoring | ❌ | Segment metrics (response, dispatch, mobilization, travel, repair, verification, total), warn/breach lists, countdowns | sla_tracking, sla_policies, jobs | `GET /sla/summary`, `GET /sla/jobs?state=` | SC SV MG | Filter, open job, request pause | L E X |
| D07a | SLA pause request/approval | ❌ | Pause with documented reason, authorized approval, audit trail. **ON_HOLD must not auto-pause SLA.** | sla_tracking, audit_logs | `POST /sla/{jobId}/pause-request`, `POST …/approve` | SC (request) SV/MG (approve) | Request, approve, reject, resume | V F X |
| D08 | Performance (team) | ❌ | Team score, SLA achievement, jobs completed, ranking table, SLA trend, weighted score with explanation; **not** raw-speed ranking | performance_scores, jobs, sla_tracking | `GET /performance/team?period=`, `GET /performance/{techId}` | MG SV SA | Change period, open tech breakdown | L E X |
| D08a | Score explanation & appeal | ❌ | Per-dimension breakdown, adjustment factors (complexity, distance, workload, spare parts, access delay, connectivity), appeal/review workflow | performance_scores, score_adjustments, appeals | `GET /performance/{id}/explain`, `POST /performance/{id}/appeal`, `POST …/appeal/{id}/decision` | TK (own) SV MG | Appeal, review, decide | V F X |
| D09 | Reports & Analytics | 🟡 `Reports.tsx`: CSV export, priority bars (incident data) | Tabs: SLA Report, Job Report, Performance, Incident; SLA trend chart, priority donut, date range, export | jobs, sla_tracking, performance_scores | `GET /reports/{type}`, `GET /reports/{type}/export` | MG SV SC SA | Switch tab, range, export | L E X |
| D10 | Settings shell (tabs) | 🟡 `Settings.tsx` is a text placeholder | Tab layout: SLA Policy, Notifications, Teams, Devices, General, Users & Roles, Scoring, GPS Policy, Audit Logs | — | — | SA (SV partial) | — | F |
| D10a | SLA Policy config | ❌ | Policies by bank/device/category/priority/hours/holidays, warning thresholds. **No hard-coded contractual values.** | sla_policies, holidays | `GET/POST/PATCH /sla-policies` | SA MG | Create, edit, activate, save | V X S |
| D10b | Notifications & escalation | ❌ | Channels, high-priority sound, repeat interval, escalation chain (accept timeout → alert → reassign) | notification_rules | `GET/PUT /notification-rules` | SA SV | Edit, save, test | V X S |
| D10c | Teams | ❌ | Teams, members, supervisors | teams, team_members | `GET/POST/PATCH /teams` | SA SV | Create team, add/remove member | L E V X |
| D10d | Devices settings | ❌ | Bulk import/maintenance of device registry, categories | atm_devices, incident_categories | `POST /devices/import`, `GET/POST /incident-categories` | SA | Import, edit | V X |
| D10e | General | 🟡 placeholder text only | Org profile, timezone, language, retention policy | companies, settings | `GET/PATCH /settings` | SA | Save | V X S |
| D10f | Users, Roles & Organization | ❌ | User CRUD, role assignment, company/bank/branch tree, deactivate | users, roles, companies, banks, branches | `GET/POST/PATCH /users`, `GET /roles`, `GET/POST /banks`, `/branches` | SA | Invite, edit role, deactivate | L E V F X |
| D10g | Audit Logs | 🟡 `audit_logs` table exists, no UI, no actor | Searchable log: actor, action, entity, before/after, time; export | audit_logs (+actor_id) | `GET /audit-logs?…` | SA MG | Filter, search, export | L E X F |
| D10h | Scoring weights (versioned) | ❌ | Weights (15/15/30/15/25 as *initial proposal*), version history, effective date | scoring_versions | `GET/POST /scoring-versions` | SA MG | Draft, publish new version | V F |
| D10i | GPS & retention policy | ❌ | Tracking only during active shift/assignment, ping interval, retention days, technician-visible notice | settings, location_pings | `GET/PUT /gps-policy` | SA | Edit, save | V F |
| D11 | Evidence review & Verification | ❌ | Report + before/after photos + checklist viewer; Approve & Close / Request Correction (reason). RESOLVED ≠ CLOSED | work_reports, job_evidence | `GET /jobs/{id}/report`, `GET /evidence/{id}` (protected), `POST /jobs/{id}/verify`, `POST …/request-correction` | SC SV | Approve, request correction | L X V F |
| D12 | Notification center (bell) | ❌ | Bell with count, list, mark read, jump to job, escalation alerts | notifications | `GET /notifications`, `POST /notifications/{id}/read`, WS `notification.*` | all desktop roles | Read, open job | L E X |

## 5. Screen inventory — Android technician (mobile-first)

| ID | Screen | Existing | Missing | Data deps | API deps | Roles | Interactive actions | States |
|---|---|---|---|---|---|---|---|---|
| M00 | Login | ❌ | Auth, secure token storage, biometric (optional) | users | `POST /auth/login` | TK | Sign in/out | L X V |
| M01 | Home | ❌ | Online/offline badge, assigned jobs, new-assignment card, shift status | jobs, shifts | `GET /me/jobs`, WS `assignment.new` | TK | Open job, start/end shift | L E X O |
| M02 | Incoming Job | ❌ | Prominent alert, job ID, device ID, incident type, priority, location, SLA deadline | jobs, notifications | `GET /jobs/{id}`, push (FCM) | TK | **Accept**, **Reject (reason mandatory)** | L V X O |
| M03 | Job Details | ❌ | Full instructions, device info, SLA countdown, contacts, status-appropriate actions | jobs, atm_devices | `GET /jobs/{id}` | TK (own jobs only) | Start journey, hold, resume | L X F O |
| M04 | Navigation | ❌ | Map + route + ETA, tracking-active indicator, "Arrived" button | jobs, location_pings | `POST /jobs/{id}/location`, `POST /jobs/{id}/start-journey` | TK | Start journey, mark arrived | L X O |
| M05 | Arrival Confirmation | ❌ | Confirm arrival, record timestamp (+ location if permitted) | job_events | `POST /jobs/{id}/arrive` | TK | Confirm arrival | V X O |
| M06 | Work Checklist | ❌ | Checklist per category (e.g., power, dispenser, reject bin), hold-with-reason, resume | work_reports, checklist_templates | `GET /checklists/{categoryId}`, `POST /jobs/{id}/start-work`, `/hold`, `/resume` | TK | Tick items, hold, resume | V X O |
| M07 | Evidence Upload | ❌ | Camera capture, before/after photos, queued upload, size/type validation | job_evidence | `POST /jobs/{id}/evidence` (protected storage) | TK | Capture, retake, upload | V X O |
| M08 | Job Report | ❌ | Resolution result, notes, parts used, submit | work_reports | `POST /jobs/{id}/resolve`, `POST /jobs/{id}/report` | TK | Submit (→ RESOLVED/VERIFICATION) | V X O |
| M09 | Personal Performance | ❌ | Own score, dimension breakdown, explanation, appeal link | performance_scores | `GET /me/performance` | TK | View, appeal | L E X |
| M10 | Shift Status | ❌ | Start/end shift, availability, tracking notice | shifts | `POST /me/shift/start`, `/end` | TK | Start/end shift | L X |
| M11 | Profile | ❌ | Profile, settings, notification sound, language, sign out | users | `GET/PATCH /me` | TK | Edit, sign out | L X V |
| M12 | Sync queue | ❌ | List of pending actions; each marked **Local / Pending sync / Server confirmed**; never show unsynced as confirmed | local store | `POST /sync` (idempotent) | TK | Retry, view | O X |
| M13 | Reject / Hold reason sheets | ❌ | Mandatory reason picker + text | job_events | part of M02/M06 endpoints | TK | Submit reason | V |

## 6. Job status transitions (server-validated)

States: CREATED, ASSIGNED, NOTIFIED, ACCEPTED, REJECTED, EN_ROUTE, ARRIVED, IN_PROGRESS, ON_HOLD, RESOLVED, VERIFICATION, CLOSED, CANCELLED.

| From → To | Actor | Required |
|---|---|---|
| CREATED → ASSIGNED | SC SV | technician in same tenant, on shift/available |
| ASSIGNED → NOTIFIED | system | notification dispatched |
| NOTIFIED → ACCEPTED | TK (assignee) | — |
| NOTIFIED → REJECTED | TK (assignee) | reason |
| NOTIFIED → (timeout) → escalation | system | configured timeout |
| REJECTED / escalation → ASSIGNED | SC SV | reassign reason |
| ACCEPTED → EN_ROUTE | TK | tracking notice shown |
| EN_ROUTE → ARRIVED | TK | — |
| ARRIVED → IN_PROGRESS | TK | — |
| IN_PROGRESS ↔ ON_HOLD | TK | reason; **does not pause SLA** |
| IN_PROGRESS → RESOLVED | TK | report (+ evidence per policy) |
| RESOLVED → VERIFICATION | system | report submitted |
| VERIFICATION → CLOSED | SC SV | approval |
| VERIFICATION → IN_PROGRESS | SC SV | correction reason |
| any non-terminal → CANCELLED | SC SV | reason |

Every transition writes a `job_events` row and an `audit_logs` row, and recomputes `sla_tracking`.

## 7. Decisions needed before architectural changes

1. **Stack.** Spec recommends Electron+React / Flutter / NestJS / PostgreSQL / Docker. Existing is React+Vite / FastAPI / SQLite. Flutter, Docker and PostgreSQL are **not installed** here, so Android (Flutter) and Postgres could not be run or tested on this machine.
2. **Legacy ServiceMAX monitor** (extension, mock bank portals, dark UI, incident table): keep as an optional incident *source* feeding TechSO jobs, move to `legacy/`, or delete.
3. **Tenancy depth** for phase 1: `company_id` on all rows with server-side filtering (recommended), or full bank/branch scoping from day one.
4. **GPS / maps / push**: Google Maps and FCM need API keys and accounts. Until provided, phase 1 would use clearly labeled stub adapters.
