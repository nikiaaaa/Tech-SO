"""Authentication, role-based access and tenant isolation."""
from app.config import settings
from tests.conftest import PW, PNG, drive, make_job, start_shift


def test_login_ok_and_generic_failures(c, w):
    ok = c.post("/api/v1/auth/login", json={"email": w.email["scheduler"], "password": PW})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "scheduler"
    wrong = c.post("/api/v1/auth/login", json={"email": w.email["scheduler"], "password": "nope-nope-nope"})
    unknown = c.post("/api/v1/auth/login", json={"email": "ghost@x.test", "password": "nope-nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # does not reveal whether the email exists


def test_lockout_after_repeated_failures(c, w):
    for _ in range(settings.login_max_failures):
        assert c.post("/api/v1/auth/login", json={"email": w.email["tech2"], "password": "bad-bad-bad-1"}).status_code == 401
    locked = c.post("/api/v1/auth/login", json={"email": w.email["tech2"], "password": PW})
    assert locked.status_code == 423  # even the right password is refused while locked


def test_login_rate_limit(c, w, monkeypatch):
    from app import security
    security._attempts.clear()
    monkeypatch.setattr(settings, "login_rate_per_minute", 2)
    codes = [c.post("/api/v1/auth/login", json={"email": "x@y.test", "password": "bad-bad-bad-1"}).status_code for _ in range(4)]
    assert codes[-1] == 429
    security._attempts.clear()


def test_unauthenticated_and_bad_token(c, w):
    assert c.get("/api/v1/jobs").status_code == 401
    assert c.get("/api/v1/jobs", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_security_headers(c):
    r = c.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"


def test_role_matrix_for_job_creation(c, w, H):
    body = {"device_id": w.dev, "category_id": w.cat, "priority": "low", "description": "Printer is out of paper"}
    assert c.post("/api/v1/jobs", headers=H("tech1"), json=body).status_code == 403
    assert c.post("/api/v1/jobs", headers=H("manager"), json=body).status_code == 403
    for role in ("scheduler", "supervisor", "admin"):
        assert c.post("/api/v1/jobs", headers=H(role), json=body).status_code == 201


def test_management_reads_but_does_not_dispatch(c, w, H):
    job = make_job(c, H, w)
    assert c.get("/api/v1/jobs", headers=H("manager")).status_code == 200
    r = c.post(f"/api/v1/jobs/{job['id']}/assign", headers=H("manager"), json={"technician_id": w.uid["tech1"]})
    assert r.status_code == 403


def test_technician_sees_only_own_jobs(c, w, H):
    start_shift(c, H, "tech1")
    mine = drive(c, H, w, "assign", "tech1")
    other = drive(c, H, w, "assign", "tech2")
    assert c.get("/api/v1/jobs", headers=H("tech1")).status_code == 403          # no queue-wide listing
    ids = [j["id"] for j in c.get("/api/v1/me/jobs", headers=H("tech1")).json()]
    assert mine in ids and other not in ids
    assert c.get(f"/api/v1/jobs/{other}", headers=H("tech1")).status_code == 404  # does not reveal it exists


def test_only_assignee_can_act(c, w, H):
    jid = drive(c, H, w, "assign", "tech1")
    assert c.post(f"/api/v1/jobs/{jid}/accept", headers=H("tech2")).status_code == 404
    assert c.post(f"/api/v1/jobs/{jid}/accept", headers=H("scheduler")).status_code == 403


def test_tenant_isolation_everywhere(c, w, H):
    jid = drive(c, H, w, "evidence", "tech1")
    ev = c.get(f"/api/v1/jobs/{jid}/report", headers=H("scheduler")).json()["evidence"][0]["id"]
    for who in ("b_sched", "b_admin"):
        assert c.get(f"/api/v1/jobs/{jid}", headers=H(who)).status_code == 404
        assert c.get(f"/api/v1/jobs/{jid}/events", headers=H(who)).status_code == 404
        assert c.get(f"/api/v1/evidence/{ev}", headers=H(who)).status_code == 404
        assert c.get(f"/api/v1/devices/{w.dev}", headers=H(who)).status_code == 404
        assert c.get(f"/api/v1/technicians/{w.uid['tech1']}", headers=H(who)).status_code == 404
        assert c.post(f"/api/v1/jobs/{jid}/cancel", headers=H(who), json={"reason": "not yours"}).status_code == 404
        assert c.get("/api/v1/jobs", headers=H(who)).json()["total"] == 0
        assert c.get("/api/v1/devices", headers=H(who)).json()["total"] == 1  # only its own device
    assert c.get(f"/api/v1/evidence/{ev}", headers=H("scheduler")).status_code == 200


def test_cannot_mix_tenants_in_a_job(c, w, H):
    # tenant B scheduler cannot open a job on tenant A's device, nor assign tenant A's technician
    r = c.post("/api/v1/jobs", headers=H("b_sched"), json={"device_id": w.dev, "priority": "low", "description": "cross tenant attempt"})
    assert r.status_code == 404
    job_b = c.post("/api/v1/jobs", headers=H("b_sched"), json={"device_id": w.dev_b, "priority": "low", "description": "tenant b own job"}).json()
    r = c.post(f"/api/v1/jobs/{job_b['id']}/assign", headers=H("b_sched"), json={"technician_id": w.uid["tech1"]})
    assert r.status_code == 404


def test_super_admin_does_not_cross_tenants(c, w, H):
    drive(c, H, w, "assign", "tech1")
    assert c.get("/api/v1/audit-logs?action=job.", headers=H("b_admin")).json()["total"] == 0   # none of tenant A's job activity
    emails = [u["email"] for u in c.get("/api/v1/users", headers=H("b_admin")).json()]
    assert len(emails) == 3 and all(e.endswith("@b.test") for e in emails)


def test_evidence_validation_and_access(c, w, H):
    jid = drive(c, H, w, "assign", "tech1")
    up = lambda who, name, data, kind="before": c.post(f"/api/v1/jobs/{jid}/evidence", headers=H(who), data={"kind": kind}, files={"file": (name, data, "image/png")})
    assert up("tech1", "x.png", PNG).status_code == 409             # not on site yet
    for step in ("accept", "start-journey", "arrive"):
        assert c.post(f"/api/v1/jobs/{jid}/{step}", headers=H("tech1")).status_code == 200
    assert up("tech1", "fake.png", b"this is not an image").status_code == 415   # magic bytes checked, not the name
    assert up("tech1", "x.png", PNG, kind="selfie").status_code == 422
    assert up("tech2", "x.png", PNG).status_code == 404            # other technician cannot see the job
    assert up("scheduler", "x.png", PNG).status_code == 403        # staff do not upload field evidence
    ok = up("tech1", "../../etc/passwd.png", PNG)
    assert ok.status_code == 201 and "stored_name" not in ok.json()  # storage path is never exposed
    assert c.get(f"/api/v1/evidence/{ok.json()['id']}", headers=H("tech2")).status_code == 404


def test_evidence_size_limit(c, w, H, monkeypatch):
    jid = drive(c, H, w, "assign", "tech1")
    for step in ("accept", "start-journey", "arrive"):
        c.post(f"/api/v1/jobs/{jid}/{step}", headers=H("tech1"))
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    big = PNG + b"\0" * (1024 * 1024 + 10)
    r = c.post(f"/api/v1/jobs/{jid}/evidence", headers=H("tech1"), data={"kind": "after"}, files={"file": ("big.png", big, "image/png")})
    assert r.status_code == 413
