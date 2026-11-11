"""Job lifecycle, SLA, escalation, sync and the demo flow end to end."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, JobEvent, Notification, PerformanceScore
from tests.conftest import PNG, age, drive, make_job, start_shift


def jget(c, H, jid, who="scheduler"):
    return c.get(f"/api/v1/jobs/{jid}", headers=H(who)).json()


def test_full_happy_path_with_audit_and_score(c, w, H):
    jid = drive(c, H, w, "verify")
    job = jget(c, H, jid)
    assert job["status"] == "CLOSED"
    path = [e["to"] for e in job["events"] if e["to"]]
    assert path == ["CREATED", "ASSIGNED", "NOTIFIED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "RESOLVED", "VERIFICATION", "CLOSED"]
    db = SessionLocal()
    actions = {a.action for a in db.scalars(select(AuditLog).where(AuditLog.entity_id == jid))}
    assert {"job.created", "job.assigned", "job.accepted", "job.arrived", "job.resolved", "job.verified_closed"} <= actions
    score = db.scalar(select(PerformanceScore).where(PerformanceScore.job_id == jid))
    assert score and 0 <= score.total <= 100 and score.explanation and score.scoring_version == 1
    db.close()


def test_resolved_is_not_closed_until_scheduler_verifies(c, w, H):
    jid = drive(c, H, w, "resolve")
    assert jget(c, H, jid)["status"] == "VERIFICATION"
    assert c.post(f"/api/v1/jobs/{jid}/verify", headers=H("tech1")).status_code == 403


def test_invalid_transitions_are_rejected_by_the_server(c, w, H):
    jid = make_job(c, H, w)["id"]
    assert c.post(f"/api/v1/jobs/{jid}/verify", headers=H("scheduler")).status_code == 409
    c.post(f"/api/v1/jobs/{jid}/assign", headers=H("scheduler"), json={"technician_id": w.uid["tech1"]})
    for step in ("arrive", "start-work", "resume"):
        assert c.post(f"/api/v1/jobs/{jid}/{step}", headers=H("tech1")).status_code == 409
    assert c.post(f"/api/v1/jobs/{jid}/assign", headers=H("scheduler"), json={"technician_id": w.uid["tech1"]}).status_code == 409  # already assigned


def test_reject_needs_reason_then_reassign(c, w, H):
    jid = drive(c, H, w, "assign", "tech1")
    assert c.post(f"/api/v1/jobs/{jid}/reject", headers=H("tech1"), json={"reason": ""}).status_code == 422
    assert c.post(f"/api/v1/jobs/{jid}/reject", headers=H("tech1"), json={"reason": "Vehicle breakdown"}).status_code == 200
    job = jget(c, H, jid)
    assert job["status"] == "REJECTED" and job["assignee"] is None
    assert c.post(f"/api/v1/jobs/{jid}/reassign", headers=H("scheduler"), json={"technician_id": w.uid["tech2"], "reason": ""}).status_code == 422
    r = c.post(f"/api/v1/jobs/{jid}/reassign", headers=H("scheduler"), json={"technician_id": w.uid["tech2"], "reason": "Reassigned after rejection"})
    assert r.status_code == 200 and r.json()["status"] == "NOTIFIED"
    assert c.get(f"/api/v1/jobs/{jid}", headers=H("tech1")).status_code == 404   # previous technician loses access
    assert c.post(f"/api/v1/jobs/{jid}/accept", headers=H("tech2")).status_code == 200


def test_hold_rules_and_hold_does_not_pause_sla(c, w, H):
    jid = drive(c, H, w, "start-work", "tech1")
    assert c.post(f"/api/v1/jobs/{jid}/hold", headers=H("tech1"), json={"reason_code": "lunch"}).status_code == 422
    assert c.post(f"/api/v1/jobs/{jid}/hold", headers=H("tech1"), json={"reason_code": "other"}).status_code == 422  # note required
    assert c.post(f"/api/v1/jobs/{jid}/hold", headers=H("tech1"), json={"reason_code": "spare_part_unavailable"}).status_code == 200
    age(jid, 130)  # high priority total target = 120 min
    job = jget(c, H, jid)
    assert job["status"] == "ON_HOLD" and job["sla"]["paused_seconds"] == 0 and job["sla"]["state"] == "breach"


def test_resolve_requires_notes_after_photo_and_correction_loop(c, w, H):
    jid = drive(c, H, w, "start-work", "tech1")
    body = {"resolution": "repaired", "notes": "Replaced the dispenser belt.", "checklist": []}
    assert c.post(f"/api/v1/jobs/{jid}/resolve", headers=H("tech1"), json=body).status_code == 422          # no after photo yet
    c.post(f"/api/v1/jobs/{jid}/evidence", headers=H("tech1"), data={"kind": "after"}, files={"file": ("a.png", PNG, "image/png")})
    assert c.post(f"/api/v1/jobs/{jid}/resolve", headers=H("tech1"), json={**body, "notes": "ok"}).status_code == 422
    assert c.post(f"/api/v1/jobs/{jid}/resolve", headers=H("tech1"), json={**body, "resolution": "magic"}).status_code == 422
    assert c.post(f"/api/v1/jobs/{jid}/resolve", headers=H("tech1"), json=body).status_code == 200
    assert c.post(f"/api/v1/jobs/{jid}/request-correction", headers=H("scheduler"), json={"reason": "Self-test result missing"}).status_code == 200
    job = jget(c, H, jid)
    assert job["status"] == "IN_PROGRESS" and job["correction_count"] == 1
    assert c.post(f"/api/v1/jobs/{jid}/resolve", headers=H("tech1"), json=body).status_code == 200
    assert jget(c, H, jid)["report"]["version"] == 2


def test_cancel_requires_reason_and_is_terminal(c, w, H):
    jid = make_job(c, H, w)["id"]
    assert c.post(f"/api/v1/jobs/{jid}/cancel", headers=H("scheduler"), json={"reason": ""}).status_code == 422
    assert c.post(f"/api/v1/jobs/{jid}/cancel", headers=H("scheduler"), json={"reason": "Duplicate report"}).status_code == 200
    assert c.post(f"/api/v1/jobs/{jid}/cancel", headers=H("scheduler"), json={"reason": "again"}).status_code == 409
    assert c.post(f"/api/v1/jobs/{jid}/assign", headers=H("scheduler"), json={"technician_id": w.uid["tech1"]}).status_code == 409


def test_job_listing_filters_search_and_paging(c, w, H):
    a = make_job(c, H, w, "critical")["id"]
    make_job(c, H, w, "low")
    assert c.get("/api/v1/jobs?priority=critical", headers=H("scheduler")).json()["total"] == 1
    assert c.get("/api/v1/jobs?q=ATM-A-1", headers=H("scheduler")).json()["total"] == 2
    assert c.get("/api/v1/jobs?q=%25", headers=H("scheduler")).json()["total"] == 0        # wildcard is escaped, not a match-all
    assert len(c.get("/api/v1/jobs?page_size=1&page=2", headers=H("scheduler")).json()["items"]) == 1
    assert c.get("/api/v1/jobs?status=CREATED&sort=priority", headers=H("scheduler")).json()["items"][0]["id"] == a


# ---------------------------------------------------------------- SLA
def test_sla_states_follow_elapsed_time(c, w, H):
    start_shift(c, H)
    ok = drive(c, H, w, "assign", priority="high")
    warn = drive(c, H, w, "assign", priority="high")
    late = drive(c, H, w, "assign", priority="high")
    age(warn, 100)   # 100/120 = 83% >= 80% warning threshold
    age(late, 125)
    assert [jget(c, H, j)["sla"]["state"] for j in (ok, warn, late)] == ["on_track", "warning", "breach"]


def test_job_without_policy_reports_no_policy_not_a_made_up_target(c, w, H):
    job = c.post("/api/v1/jobs", headers=H("b_sched"), json={"device_id": w.dev_b, "priority": "high", "description": "tenant without SLA policies"}).json()
    assert job["sla"]["state"] == "no_policy" and job["sla"]["due_at"] is None


def test_sla_pause_needs_documented_reason_and_second_approver(c, w, H):
    jid = make_job(c, H, w)["id"]
    assert c.post(f"/api/v1/sla/{jid}/pause-request", headers=H("tech1"), json={"reason": "I need more time please"}).status_code == 403
    assert c.post(f"/api/v1/sla/{jid}/pause-request", headers=H("scheduler"), json={"reason": "short"}).status_code == 422
    pid = c.post(f"/api/v1/sla/{jid}/pause-request", headers=H("scheduler"), json={"reason": "Branch denied access until manager arrives"}).json()["id"]
    assert c.post(f"/api/v1/sla/{jid}/pause-request", headers=H("scheduler"), json={"reason": "Branch denied access until manager arrives"}).status_code == 409
    assert c.post(f"/api/v1/sla/pauses/{pid}/decision", headers=H("scheduler"), json={"approve": True, "note": "self approve"}).status_code == 403
    assert c.post(f"/api/v1/sla/pauses/{pid}/decision", headers=H("supervisor"), json={"approve": True, "note": "Verified by phone"}).status_code == 200
    age(jid, 90)
    assert jget(c, H, jid)["sla"]["paused_seconds"] >= 0
    db = SessionLocal()
    assert any(a.action in ("sla.pause_requested", "sla.pause_decided") for a in db.scalars(select(AuditLog).where(AuditLog.entity == "sla_pause")))
    db.close()
    assert c.post(f"/api/v1/sla/pauses/{pid}/end", headers=H("supervisor")).status_code == 200


# ---------------------------------------------------------------- escalation
def test_escalation_after_accept_timeout_runs_once(c, w, H):
    jid = drive(c, H, w, "assign", "tech1")
    age(jid, 15)  # default accept timeout is 10 min
    assert c.post("/api/v1/admin/escalation/run", headers=H("scheduler")).status_code == 403
    assert c.post("/api/v1/admin/escalation/run", headers=H("supervisor")).json()["escalated"] == 1
    assert c.post("/api/v1/admin/escalation/run", headers=H("supervisor")).json()["escalated"] == 0
    db = SessionLocal()
    assert db.scalar(select(JobEvent).where(JobEvent.job_id == jid, JobEvent.event_type == "escalation"))
    assert db.scalar(select(Notification).where(Notification.job_id == jid, Notification.kind == "escalation", Notification.user_id == w.uid["supervisor"]))
    db.close()


# ---------------------------------------------------------------- offline sync
def test_sync_is_idempotent_and_reports_refused_actions(c, w, H):
    start_shift(c, H)
    jid = drive(c, H, w, "assign", "tech1")
    acts = [
        {"client_id": "a1", "type": "accept", "job_id": jid, "occurred_at": None, "payload": {}},
        {"client_id": "a2", "type": "start_journey", "job_id": jid, "payload": {}},
        {"client_id": "a3", "type": "start_work", "job_id": jid, "payload": {}},       # invalid: not arrived yet
        {"client_id": "a4", "type": "teleport", "job_id": jid, "payload": {}},         # unknown type
    ]
    res = c.post("/api/v1/sync", headers=H("tech1"), json={"actions": acts}).json()["results"]
    assert [r["status"] for r in res] == ["confirmed", "confirmed", "rejected", "rejected"]
    again = c.post("/api/v1/sync", headers=H("tech1"), json={"actions": acts}).json()["results"]
    assert all(r.get("replayed") for r in again)
    db = SessionLocal()
    assert len(list(db.scalars(select(JobEvent).where(JobEvent.job_id == jid, JobEvent.to_status == "ACCEPTED")))) == 1  # no duplicates
    db.close()
    assert c.post("/api/v1/sync", headers=H("scheduler"), json={"actions": []}).status_code == 403


def test_sync_keeps_device_time_but_never_the_future(c, w, H):
    jid = drive(c, H, w, "assign", "tech1")
    c.post("/api/v1/sync", headers=H("tech1"), json={"actions": [
        {"client_id": "t1", "type": "accept", "job_id": jid, "occurred_at": "2999-01-01T00:00:00Z", "payload": {}}]})
    ev = [e for e in jget(c, H, jid)["events"] if e["to"] == "ACCEPTED"][0]
    assert ev["occurred_at"] < "2100"  # clamped to the receive time


# ---------------------------------------------------------------- realtime
def test_websocket_requires_valid_token_and_pushes_job_events(c, w, H):
    import pytest
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    from app.main import app
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws?token=bad"):
                pass
        tok = H("scheduler")["Authorization"].split()[1]
        with client.websocket_connect(f"/ws?token={tok}") as ws:
            r = client.post("/api/v1/jobs", headers=H("scheduler"), json={"device_id": w.dev, "priority": "low", "description": "websocket push check"})
            assert r.status_code == 201
            msg = ws.receive_json()
            assert msg["type"] == "job.created" and msg["job_id"] == r.json()["id"]


def test_websocket_rejects_foreign_origin(c, w, H):
    import pytest
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    from app.main import app
    tok = H("scheduler")["Authorization"].split()[1]
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/ws?token={tok}", headers={"origin": "https://evil.example"}):
                pass


def test_realtime_event_not_sent_when_transaction_rolls_back(c, w, H):
    from app.services.core import emit
    from app.realtime import hub
    sent = []
    orig = hub.publish
    hub.publish = lambda *a, **k: sent.append(a)
    try:
        from app.db import get_db
        db = SessionLocal()
        db.execute(select(1))
        emit(db, w.A, {"type": "x"})
        db.rollback()
        db.commit()
        assert sent == []
        gen = get_db()                      # the request-scoped session also discards uncommitted events
        s2 = next(gen)
        emit(s2, w.A, {"type": "z"})
        gen.close()
        assert sent == []
        emit(db, w.A, {"type": "y"})
        db.commit()
        assert len(sent) == 1
        db.close()
    finally:
        hub.publish = orig
