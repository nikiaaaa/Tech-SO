# TechSO API

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
| POST | `/admin/escalation/run` | run_escalation |
| GET | `/audit-logs` | audit_logs |
| POST | `/auth/login` | login |
| POST | `/auth/logout` | logout |
| GET | `/auth/me` | me |
| POST | `/auth/refresh` | refresh |
| GET | `/banks` | banks |
| POST | `/banks` | create_bank |
| GET | `/branches` | branches |
| POST | `/branches` | create_branch |
| GET | `/checklists/{category_id}` | checklist |
| GET | `/devices` | devices |
| POST | `/devices` | create_device |
| POST | `/devices/import` | import_devices |
| GET | `/devices/{device_id}` | device |
| PATCH | `/devices/{device_id}` | patch_device |
| GET | `/devices/{device_id}/jobs` | device_jobs |
| GET | `/evidence/{evidence_id}` | get_evidence |
| GET | `/incident-categories` | categories |
| POST | `/incident-categories` | create_category |
| PUT | `/incident-categories/{cid}` | update_category |
| GET | `/jobs` | list_jobs |
| POST | `/jobs` | create_job |
| GET | `/jobs/{job_id}` | get_job |
| POST | `/jobs/{job_id}/accept` | accept |
| POST | `/jobs/{job_id}/arrive` | arrive |
| POST | `/jobs/{job_id}/assign` | assign |
| POST | `/jobs/{job_id}/cancel` | cancel |
| GET | `/jobs/{job_id}/candidates` | candidates |
| GET | `/jobs/{job_id}/events` | job_events |
| POST | `/jobs/{job_id}/evidence` | upload_evidence |
| POST | `/jobs/{job_id}/hold` | hold |
| POST | `/jobs/{job_id}/reassign` | reassign |
| POST | `/jobs/{job_id}/reject` | reject |
| GET | `/jobs/{job_id}/report` | report |
| POST | `/jobs/{job_id}/request-correction` | request_correction |
| POST | `/jobs/{job_id}/resolve` | resolve |
| POST | `/jobs/{job_id}/resume` | resume |
| POST | `/jobs/{job_id}/start-journey` | start_journey |
| POST | `/jobs/{job_id}/start-work` | start_work |
| POST | `/jobs/{job_id}/verify` | verify |
| GET | `/me` | get_me |
| PATCH | `/me` | patch_me |
| GET | `/me/jobs` | my_jobs |
| POST | `/me/location` | location |
| GET | `/me/performance` | my_performance |
| GET | `/me/shift` | my_shift |
| POST | `/me/shift/end` | end_shift |
| POST | `/me/shift/start` | start_shift |
| GET | `/me/tracking` | tracking |
| GET | `/notifications` | notifications |
| POST | `/notifications/read-all` | read_all |
| POST | `/notifications/{nid}/read` | read_notification |
| GET | `/overview` | overview |
| GET | `/performance/appeals` | perf_appeals |
| POST | `/performance/appeals/{appeal_id}/decision` | perf_decide |
| POST | `/performance/scores/{score_id}/appeal` | perf_appeal |
| GET | `/performance/team` | perf_team |
| GET | `/performance/{tech_id}` | perf_tech |
| GET | `/reports/{kind}` | report |
| GET | `/reports/{kind}/export` | report_export |
| GET | `/roles` | roles |
| GET | `/scoring-versions` | scoring_versions |
| POST | `/scoring-versions` | scoring_publish |
| GET | `/settings/{key}` | read_setting |
| PUT | `/settings/{key}` | write_setting |
| GET | `/shifts` | shifts |
| POST | `/shifts` | create_shift |
| GET | `/sla-policies` | sla_policies |
| POST | `/sla-policies` | create_policy |
| PUT | `/sla-policies/{pid}` | update_policy |
| GET | `/sla/jobs` | sla_jobs |
| GET | `/sla/pauses` | sla_pauses |
| POST | `/sla/pauses/{pause_id}/decision` | pause_decision |
| POST | `/sla/pauses/{pause_id}/end` | pause_end |
| POST | `/sla/preview` | preview |
| GET | `/sla/summary` | sla_summary |
| POST | `/sla/{job_id}/pause-request` | pause_request |
| POST | `/sync` | sync |
| GET | `/teams` | teams |
| POST | `/teams` | create_team |
| POST | `/teams/{team_id}/members` | add_member |
| DELETE | `/teams/{team_id}/members/{user_id}` | remove_member |
| GET | `/technicians` | technicians |
| GET | `/technicians/live` | technicians_live |
| GET | `/technicians/{tech_id}` | technician |
| GET | `/technicians/{tech_id}/shifts` | tech_shifts |
| GET | `/users` | users |
| POST | `/users` | create_user |
| PATCH | `/users/{uid}` | patch_user |
| GET | `/health` | health — Liveness + database reachability, for uptime checks. |
| WS | `/ws` | ws_endpoint |
