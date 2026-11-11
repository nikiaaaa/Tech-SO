# Security, privacy and GPS policy

## Controls implemented (and tested in `backend/tests`)

| Area | Control |
|---|---|
| Authentication | scrypt password hashes (stdlib), HS256 JWT with expiry, generic login error (no account enumeration), account lock after 5 failures (15 min), per-IP login and API rate limits, deactivated users lose access on the next request |
| Authorization | Role permissions checked in the service layer; technicians see only their own jobs; management is read-only for dispatch |
| Tenant isolation | `company_id` on every operational row, taken from the token; cross-tenant ids return 404; tested for jobs, events, evidence, devices, technicians, users, audit, live positions, SLA policies |
| Input validation | Pydantic models with lengths/enums, unknown fields refused on settings, LIKE wildcards escaped, CSV export neutralizes spreadsheet formulas |
| Uploads | Magic-byte check (JPEG/PNG/WebP only), size cap, generated storage names (no user path), stored outside any web root, served only via an authorized endpoint with `nosniff` |
| Audit | Every job transition, assignment, setting, user, SLA-pause, device, appeal and export is logged with actor; secrets/password hashes are redacted from audit payloads |
| Transport/headers | CORS allow-list, WebSocket Origin check, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; `/docs` disabled in production |
| Errors | Unhandled errors return a generic 500 and are logged server-side without request bodies |
| Secrets | `.env` only; production refuses to start with the dev secret; demo seed refuses to run in production |

## Not implemented yet (do not assume these exist)
MFA · refresh-token rotation / server-side token revocation · virus scanning of uploads · encryption at rest (rely on disk/DB encryption) · automated database backups and monitoring (procedures are in DEPLOYMENT.md) · shared-store rate limiting across multiple workers · the WebSocket carries its token in the query string (short-lived; access logging is disabled in `run.py` and the Dockerfile for this reason).

## GPS policy (technician location)

1. **When:** location is stored only while the technician has an **active shift** or an **active assignment** (accepted … on hold). Otherwise the API refuses it (`403`).
2. **Transparency:** the technician app shows a persistent "location tracking is active" banner with the reason and the retention period, and the GPS policy is readable by technicians.
3. **Who sees it:** only dispatch and management roles (`gps:read_live`); technicians cannot read anyone's location.
4. **Retention:** configurable (default 30 days); expired pings are purged hourly (`gps.purge_old`).
5. **Quality:** pings with accuracy worse than the configured limit are rejected; positions have an age and a *stale* flag; throttled to the configured interval.
6. **Use:** a position is a hint for dispatch (distance/ETA estimates), **not proof of misconduct**. Performance scoring only uses it to give travel-distance *allowance*, never a penalty.
7. **Control:** a super admin can disable tracking per company (`/settings/gps_policy`).

## Demo data
All companies, banks, people, addresses and incidents in `app.seed` are fictional and labelled DEMO. No real bank system is contacted.
