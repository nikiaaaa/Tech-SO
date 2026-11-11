"""Performance scoring, appeals, users, settings, audit and reports."""
import json

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, PerformanceScore
from app.services.reports import _safe
from tests.conftest import PW, age, drive


def closed_job(c, H, w, tech="tech1"):
    jid = drive(c, H, w, "verify", tech)
    return jid


def score_id(jid):
    db = SessionLocal()
    s = db.scalar(select(PerformanceScore).where(PerformanceScore.job_id == jid)).id
    db.close()
    return s


# ------------------------------------------------------------ scoring
def test_score_is_explained_and_uses_configured_weights(c, w, H):
    jid = closed_job(c, H, w)
    s = c.get(f"/api/v1/performance/{w.uid['tech1']}", headers=H("tech1")).json()["scores"][0]
    assert s["job_id"] == jid and set(s["dimensions"]) == {"response_time", "mobilization", "sla_achievement", "documentation", "resolution_quality"}
    assert s["explanation"] and s["adjustments"] and s["scoring_version"] == 1


def test_technician_sees_only_own_performance(c, w, H):
    closed_job(c, H, w)
    assert c.get(f"/api/v1/performance/{w.uid['tech1']}", headers=H("tech2")).status_code == 403
    assert c.get("/api/v1/performance/team", headers=H("tech1")).status_code == 403
    team = c.get("/api/v1/performance/team", headers=H("manager")).json()
    assert team["ranking"][0]["full_name"] == "Tech1" and "Not by raw completion time" in team["ranking_note"]


def test_weights_must_add_up_and_are_versioned(c, w, H):
    dims = {"response_time": 20, "mobilization": 10, "sla_achievement": 30, "documentation": 10, "resolution_quality": 30}
    assert c.post("/api/v1/scoring-versions", headers=H("manager"), json={"weights": {**dims, "documentation": 9}}).status_code == 422
    assert c.post("/api/v1/scoring-versions", headers=H("scheduler"), json={"weights": dims}).status_code == 403
    first = closed_job(c, H, w)
    v2 = c.post("/api/v1/scoring-versions", headers=H("manager"), json={"weights": dims, "note": "more weight on quality"}).json()
    assert v2["version"] == 2
    second = closed_job(c, H, w)
    assert c.get(f"/api/v1/performance/{w.uid['tech1']}", headers=H("tech1")).json()["scores"]
    scores = {s["job_id"]: s["scoring_version"] for s in c.get(f"/api/v1/performance/{w.uid['tech1']}", headers=H("tech1")).json()["scores"]}
    assert scores[first] == 1 and scores[second] == 2          # old scores keep the version they were computed with
    assert len(c.get("/api/v1/scoring-versions", headers=H("manager")).json()) == 2


def test_excusable_hold_is_explained_and_not_penalised(c, w, H):
    from app.db import SessionLocal as S
    from app.models import JobEvent
    jid = drive(c, H, w, "start-work", "tech1")
    c.post(f"/api/v1/jobs/{jid}/hold", headers=H("tech1"), json={"reason_code": "site_access_delay"})
    c.post(f"/api/v1/jobs/{jid}/resume", headers=H("tech1"))
    db = S()
    for e in db.scalars(select(JobEvent).where(JobEvent.job_id == jid, JobEvent.to_status.in_(["ON_HOLD", "IN_PROGRESS"]))):
        if e.to_status == "ON_HOLD":
            from datetime import timedelta
            e.occurred_at = e.occurred_at - timedelta(minutes=50)
    db.commit()
    db.close()
    for kind in ("before", "after"):
        from tests.conftest import PNG
        c.post(f"/api/v1/jobs/{jid}/evidence", headers=H("tech1"), data={"kind": kind}, files={"file": ("p.png", PNG, "image/png")})
    c.post(f"/api/v1/jobs/{jid}/resolve", headers=H("tech1"), json={"resolution": "repaired", "notes": "Fixed after access was granted.", "checklist": []})
    c.post(f"/api/v1/jobs/{jid}/verify", headers=H("scheduler"))
    adj = [a["factor"] for a in c.get(f"/api/v1/performance/{w.uid['tech1']}", headers=H("tech1")).json()["scores"][0]["adjustments"]]
    assert "excusable_hold" in adj


# ------------------------------------------------------------ appeals
def test_appeal_flow_and_permissions(c, w, H):
    sid = score_id(closed_job(c, H, w))
    assert c.post(f"/api/v1/performance/scores/{sid}/appeal", headers=H("tech2"), json={"reason": "This is not my score at all"}).status_code == 403
    assert c.post(f"/api/v1/performance/scores/{sid}/appeal", headers=H("tech1"), json={"reason": "short"}).status_code == 422
    aid = c.post(f"/api/v1/performance/scores/{sid}/appeal", headers=H("tech1"), json={"reason": "Site power was restored late by the utility."}).json()["id"]
    assert c.post(f"/api/v1/performance/scores/{sid}/appeal", headers=H("tech1"), json={"reason": "Same appeal again, please review"}).status_code == 409
    body = {"accept": True, "note": "Utility outage confirmed", "new_total": 91}
    assert c.post(f"/api/v1/performance/appeals/{aid}/decision", headers=H("tech1"), json=body).status_code == 403
    assert c.post(f"/api/v1/performance/appeals/{aid}/decision", headers=H("supervisor"), json={"accept": True, "note": "no score given"}).status_code == 422
    assert c.post(f"/api/v1/performance/appeals/{aid}/decision", headers=H("supervisor"), json=body).status_code == 200
    s = c.get(f"/api/v1/performance/{w.uid['tech1']}", headers=H("tech1")).json()["scores"][0]
    assert s["effective_total"] == 91 and s["total"] != 91 and s["appeal"]["status"] == "accepted"   # original kept, override recorded
    assert c.post(f"/api/v1/performance/appeals/{aid}/decision", headers=H("supervisor"), json=body).status_code == 409


# ------------------------------------------------------------ users / settings / audit
def test_user_management_rules_and_secrets_stay_out_of_the_audit_log(c, w, H):
    new = {"email": "new.tech@a.test", "full_name": "New Tech", "role": "technician", "password": "Sup3r-secret-pass"}
    assert c.post("/api/v1/users", headers=H("supervisor"), json=new).status_code == 403
    assert c.post("/api/v1/users", headers=H("admin"), json={**new, "password": "short"}).status_code == 422
    assert c.post("/api/v1/users", headers=H("admin"), json=new).status_code == 201
    assert c.post("/api/v1/users", headers=H("admin"), json=new).status_code == 409
    uid = c.get("/api/v1/users", headers=H("admin")).json()
    target = next(u for u in uid if u["email"] == new["email"])["id"]
    assert c.patch(f"/api/v1/users/{target}", headers=H("admin"), json={"password": "An0ther-secret-pass"}).status_code == 200
    db = SessionLocal()
    dump = json.dumps([(a.before_json, a.after_json) for a in db.scalars(select(AuditLog))])
    assert "Sup3r-secret" not in dump and "An0ther-secret" not in dump and "scrypt$" not in dump
    db.close()
    assert c.patch(f"/api/v1/users/{w.uid['admin']}", headers=H("admin"), json={"is_active": False}).status_code == 409   # cannot lock yourself out
    assert c.post("/api/v1/auth/login", json={"email": new["email"], "password": "An0ther-secret-pass"}).status_code == 200


def test_deactivated_user_loses_access_immediately(c, w, H):
    tok = H("tech2")
    assert c.get("/api/v1/me", headers=tok).status_code == 200
    assert c.patch(f"/api/v1/users/{w.uid['tech2']}", headers=H("admin"), json={"is_active": False}).status_code == 200
    assert c.get("/api/v1/me", headers=tok).status_code == 401


def test_settings_permissions_and_validation(c, w, H):
    good = {"enabled": True, "min_interval_s": 15, "max_accuracy_m": 100, "stale_after_s": 300, "retention_days": 14}
    assert c.put("/api/v1/settings/gps_policy", headers=H("scheduler"), json=good).status_code == 403
    assert c.put("/api/v1/settings/gps_policy", headers=H("admin"), json={**good, "min_interval_s": 0}).status_code == 422
    assert c.put("/api/v1/settings/gps_policy", headers=H("admin"), json={**good, "surprise": 1}).status_code == 422   # unknown fields refused
    assert c.put("/api/v1/settings/gps_policy", headers=H("admin"), json=good).status_code == 200
    assert c.get("/api/v1/settings/general", headers=H("tech1")).status_code == 403
    assert c.get("/api/v1/settings/notification_rules", headers=H("tech1")).status_code == 200   # read-only: drives the alarm repeat
    assert c.put("/api/v1/settings/notification_rules", headers=H("tech1"), json={}).status_code == 403
    rules = {"accept_timeout_min": 5, "repeat_interval_min": 2, "escalate_to_roles": ["supervisor"], "high_priority_sound": True}
    assert c.put("/api/v1/settings/notification_rules", headers=H("supervisor"), json=rules).status_code == 200
    assert c.get("/api/v1/settings/nope", headers=H("admin")).status_code == 404


def test_sla_policy_configuration_is_role_limited_and_tenant_scoped(c, w, H):
    pol = {"name": "Custom", "priority": "low", "response_min": 5, "dispatch_min": 5, "mobilization_min": 5, "travel_min": 5,
           "repair_min": 5, "verification_min": 5, "total_min": 30, "warning_pct": 70}
    assert c.post("/api/v1/sla-policies", headers=H("scheduler"), json=pol).status_code == 403
    pid = c.post("/api/v1/sla-policies", headers=H("manager"), json=pol).json()["id"]
    assert c.put(f"/api/v1/sla-policies/{pid}", headers=H("b_admin"), json=pol).status_code == 404
    assert c.post("/api/v1/sla-policies", headers=H("manager"), json={**pol, "total_min": 0}).status_code == 422


def test_audit_log_access_and_filtering(c, w, H):
    drive(c, H, w, "assign", "tech1")
    assert c.get("/api/v1/audit-logs", headers=H("scheduler")).status_code == 403
    logs = c.get("/api/v1/audit-logs?action=job.", headers=H("manager")).json()
    assert logs["total"] >= 2 and all(i["action"].startswith("job.") for i in logs["items"]) and logs["items"][0]["actor"]


# ------------------------------------------------------------ reports
def test_overview_and_reports_are_computed_from_stored_jobs(c, w, H):
    closed_job(c, H, w)
    drive(c, H, w, "assign", "tech2")
    o = c.get("/api/v1/overview", headers=H("scheduler")).json()
    assert o["kpis"]["active_jobs"] == 1 and o["kpis"]["awaiting_acceptance"] == 1 and o["kpis"]["resolved"] == 1
    assert o["recent_activity"] and c.get("/api/v1/overview", headers=H("tech1")).status_code == 403
    for kind in ("jobs", "sla", "performance", "incidents"):
        assert c.get(f"/api/v1/reports/{kind}", headers=H("manager")).status_code == 200
    assert c.get("/api/v1/reports/unknown", headers=H("manager")).status_code == 404
    assert c.get("/api/v1/reports/jobs", headers=H("tech1")).status_code == 403
    sla = c.get("/api/v1/reports/sla", headers=H("manager")).json()
    assert sla["summary"]["jobs"] == 2 and sla["summary"]["compliance_pct"] == 100.0


def test_csv_export_blocks_formula_injection(c, w, H):
    assert [_safe(x) for x in ("=1+1", "+cmd", "-2+3", "@SUM(A1)", "plain", 5, -5)] == ["'=1+1", "'+cmd", "'-2+3", "'@SUM(A1)", "plain", "5", "-5"]
    closed_job(c, H, w)
    r = c.get("/api/v1/reports/jobs/export", headers=H("manager"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    assert r.text.splitlines()[0].startswith("Job,Device")


def test_device_csv_import_validates_each_row(c, w, H):
    from app.db import SessionLocal as S
    from app.models import Bank
    db = S()
    code = db.scalar(select(Bank.code).where(Bank.company_id == w.A))
    db.close()
    csv_text = f"code,device_type,bank_code,model,address,lat,lon\nATM-NEW-1,ATM,{code},M1,Jl X,-6.2,106.8\nBAD-1,TOASTER,{code},,,,\nATM-NEW-2,ATM,NOPE,,,,\nATM-NEW-3,CRM,{code},,,95,106\n"
    assert c.post("/api/v1/devices/import", headers=H("tech1"), json={"csv": csv_text}).status_code == 403
    r = c.post("/api/v1/devices/import", headers=H("scheduler"), json={"csv": csv_text}).json()
    assert r["created"] == 1 and [e["row"] for e in r["errors"]] == [3, 4, 5]
