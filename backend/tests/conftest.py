import base64
import os
import tempfile
from datetime import timedelta
from types import SimpleNamespace

# Must be set before the app is imported: isolated in-memory DB, temp evidence dir, generous rate limits.
os.environ["TECHSO_DATABASE_URL"] = "sqlite:///:memory:"
os.environ["TECHSO_EVIDENCE_DIR"] = tempfile.mkdtemp(prefix="techso-evidence-")
os.environ["TECHSO_RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["TECHSO_LOGIN_RATE_PER_MINUTE"] = "100000"
os.environ["TECHSO_ENV"] = "dev"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import (AtmDevice, Bank, Company, IncidentCategory, Job, JobAssignment, JobEvent, Shift, SlaPolicy, User)
from app.security import hash_password
from app.timeutil import now

PW = "Test-password-1"
_HASH = hash_password(PW)
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
POLICY = {"critical": (10, 10, 10, 30, 30, 15, 60), "high": (15, 20, 15, 45, 60, 30, 120),
          "medium": (30, 40, 30, 90, 120, 60, 240), "low": (60, 60, 45, 120, 240, 120, 480)}


def _user(db, cid, slug, role, suffix, skills="[]"):
    u = User(company_id=cid, email=f"{slug}@{suffix}.test", full_name=slug.title(), role=role, password_hash=_HASH, skills=skills)
    db.add(u)
    return u


@pytest.fixture()
def w():
    """Two tenants. Tenant A has SLA policies; tenant B has none."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    a, b = Company(name="Tenant A"), Company(name="Tenant B")
    db.add_all([a, b])
    db.flush()
    bank_a, bank_b = Bank(company_id=a.id, name="Bank A", code="A"), Bank(company_id=b.id, name="Bank B", code="B")
    db.add_all([bank_a, bank_b])
    db.flush()
    dev_a = AtmDevice(company_id=a.id, bank_id=bank_a.id, code="ATM-A-1", device_type="ATM", lat=-6.2088, lon=106.8456, address="Jl A")
    dev_a2 = AtmDevice(company_id=a.id, bank_id=bank_a.id, code="CRM-A-2", device_type="CRM", lat=-6.2200, lon=106.8300)
    dev_b = AtmDevice(company_id=b.id, bank_id=bank_b.id, code="ATM-B-1", device_type="ATM", lat=-6.1, lon=106.8)
    cat_a = IncidentCategory(company_id=a.id, name="Dispenser", device_type="ATM", checklist_json='["Check power","Run self-test"]')
    db.add_all([dev_a, dev_a2, dev_b, cat_a])
    for prio, (r, d, m, t, rp, v, tot) in POLICY.items():
        db.add(SlaPolicy(company_id=a.id, name=f"p-{prio}", priority=prio, response_min=r, dispatch_min=d, mobilization_min=m,
                         travel_min=t, repair_min=rp, verification_min=v, total_min=tot, warning_pct=80))
    users = {}
    for slug, role in (("admin", "super_admin"), ("manager", "management"), ("supervisor", "supervisor"), ("scheduler", "scheduler"),
                       ("tech1", "technician"), ("tech2", "technician")):
        users[slug] = _user(db, a.id, slug, role, "a", '["ATM","CRM"]' if role == "technician" else "[]")
    users["b_admin"] = _user(db, b.id, "badmin", "super_admin", "b")
    users["b_sched"] = _user(db, b.id, "bsched", "scheduler", "b")
    users["b_tech"] = _user(db, b.id, "btech", "technician", "b")
    db.commit()
    ns = SimpleNamespace(
        A=a.id, B=b.id, dev=dev_a.id, dev2=dev_a2.id, dev_b=dev_b.id, cat=cat_a.id,
        email={k: u.email for k, u in users.items()}, uid={k: u.id for k, u in users.items()}, tokens={})
    db.close()
    yield ns


@pytest.fixture()
def c():
    return TestClient(app)


@pytest.fixture()
def H(c, w):
    """H('scheduler') -> auth headers (real login path, cached per test)."""
    def get(slug):
        if slug not in w.tokens:
            r = c.post("/api/v1/auth/login", json={"email": w.email[slug], "password": PW})
            assert r.status_code == 200, r.text
            w.tokens[slug] = {"Authorization": "Bearer " + r.json()["access_token"]}
        return w.tokens[slug]
    return get


def start_shift(c, H, slug="tech1"):
    r = c.post("/api/v1/me/shift/start", headers=H(slug))
    assert r.status_code == 200, r.text
    return r.json()


def make_job(c, H, w, priority="high", device=None):
    r = c.post("/api/v1/jobs", headers=H("scheduler"), json={"device_id": device or w.dev, "category_id": w.cat, "priority": priority,
                                                             "description": "Cash dispenser reports a jam"})
    assert r.status_code == 201, r.text
    return r.json()


STEPS = ["assign", "accept", "start-journey", "arrive", "start-work", "evidence", "resolve", "verify"]


def drive(c, H, w, upto, tech="tech1", priority="high", device=None):
    """Advance a fresh job through the happy path up to and including `upto`."""
    job = make_job(c, H, w, priority, device)
    jid = job["id"]
    for step in STEPS:
        if step == "assign":
            r = c.post(f"/api/v1/jobs/{jid}/assign", headers=H("scheduler"), json={"technician_id": w.uid[tech]})
        elif step == "evidence":
            for kind in ("before", "after"):
                r = c.post(f"/api/v1/jobs/{jid}/evidence", headers=H(tech), data={"kind": kind}, files={"file": (f"{kind}.png", PNG, "image/png")})
                assert r.status_code == 201, r.text
            if upto == "evidence":
                return jid
            continue
        elif step == "resolve":
            r = c.post(f"/api/v1/jobs/{jid}/resolve", headers=H(tech), json={
                "resolution": "repaired", "notes": "Replaced the dispenser belt and ran a full self-test.",
                "checklist": [{"label": "Check power", "done": True}, {"label": "Run self-test", "done": True}]})
        elif step == "verify":
            r = c.post(f"/api/v1/jobs/{jid}/verify", headers=H("scheduler"))
        else:
            r = c.post(f"/api/v1/jobs/{jid}/{step}", headers=H(tech))
        assert r.status_code == 200, f"{step}: {r.status_code} {r.text}"
        if step == upto:
            break
    return jid


def age(jid, minutes):
    """Pretend the job (and its timeline) started `minutes` ago."""
    db = SessionLocal()
    d = timedelta(minutes=minutes)
    job = db.get(Job, jid)
    job.created_at = job.created_at - d
    for e in db.query(JobEvent).filter(JobEvent.job_id == jid):
        e.occurred_at = e.occurred_at - d
        e.created_at = e.created_at - d
    for a_ in db.query(JobAssignment).filter(JobAssignment.job_id == jid):
        a_.assigned_at = a_.assigned_at - d
    db.commit()
    db.close()
