"""Regression tests for the post-build review."""
import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.config import settings
from app.db import SessionLocal, engine
from app.main import _origin_allowed, mount_frontend
from app.models import Job
from app.services import sla
from tests.conftest import PW, age, drive, make_job


def test_sla_clock_runs_again_when_a_report_is_sent_back(c, w, H):
    jid = drive(c, H, w, "resolve", priority="high")            # VERIFICATION: clock stopped at resolution
    job = c.get(f"/api/v1/jobs/{jid}", headers=H("scheduler")).json()
    assert job["sla"]["stopped"] is True and job["sla"]["segments"]["total"]["done"] is True
    assert c.post(f"/api/v1/jobs/{jid}/request-correction", headers=H("scheduler"), json={"reason": "Self-test result missing"}).status_code == 200
    age(jid, 130)                                                # high priority total target is 120 min
    job = c.get(f"/api/v1/jobs/{jid}", headers=H("scheduler")).json()
    assert job["status"] == "IN_PROGRESS" and job["sla"]["stopped"] is False
    assert job["sla"]["segments"]["total"]["done"] is False and job["sla"]["state"] == "breach"


def test_bulk_sla_matches_single_and_does_not_query_per_job(c, w, H):
    ids = [drive(c, H, w, "accept") for _ in range(3)] + [make_job(c, H, w)["id"] for _ in range(5)]
    db = SessionLocal()
    jobs = [db.get(Job, i) for i in ids]
    single = {j.id: sla.compute(db, j, persist=False)["state"] for j in jobs}
    count = [0]
    listener = lambda *a: count.__setitem__(0, count[0] + 1)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        many = sla.compute_many(db, jobs)
    finally:
        event.remove(engine, "before_cursor_execute", listener)
        db.close()
    assert {k: v["state"] for k, v in many.items()} == single
    assert count[0] <= 3                                         # events, pauses, policies: not 3 per job


def test_technician_session_outlasts_a_staff_session(c, w):
    def minutes(slug):
        tok = c.post("/api/v1/auth/login", json={"email": w.email[slug], "password": PW}).json()["access_token"]
        claims = jwt.decode(tok, settings.secret_key, algorithms=["HS256"])
        return claims["exp"]
    assert minutes("tech1") - minutes("scheduler") > 60 * 60    # technicians keep working through poor signal


def test_websocket_origin_rule():
    assert _origin_allowed(None, "app.example")                               # scripts/native clients: token still required
    assert _origin_allowed("http://localhost:5173", "127.0.0.1:8000")         # configured dev origin
    assert _origin_allowed("https://ops.example:8443", "ops.example:8443")    # same host: API serves the app / proxy
    assert not _origin_allowed("https://evil.example", "ops.example:8443")
    assert not _origin_allowed("https://ops.example.evil.test", "ops.example")


def test_seed_reset_removes_only_company_evidence_folders(tmp_path, monkeypatch):
    from app import seed as seed_mod
    company = tmp_path / "3f2b8c1e-0000-4000-8000-000000000001"
    (company / "job").mkdir(parents=True)
    (company / "job" / "p.png").write_bytes(b"x")
    (tmp_path / "keep-me").mkdir()
    (tmp_path / "notes.txt").write_text("not evidence")
    monkeypatch.setattr(seed_mod.settings, "evidence_dir", tmp_path)
    monkeypatch.setattr(seed_mod.Seeder, "reference", lambda self: None)
    monkeypatch.setattr(seed_mod.Seeder, "run", lambda self: None)
    monkeypatch.setattr(seed_mod.Base.metadata, "drop_all", lambda *a, **k: None)
    seed_mod.seed(reset=True)
    assert not company.exists()
    assert (tmp_path / "keep-me").is_dir() and (tmp_path / "notes.txt").is_file()


def test_dispatch_eta_accounts_for_roads(c, w, H):
    from tests.conftest import start_shift
    start_shift(c, H)
    c.post("/api/v1/me/location", headers=H("tech1"), json={"lat": -6.2088, "lon": 106.8726, "accuracy_m": 10})  # ~3 km east of ATM-A-1
    jid = make_job(c, H, w)["id"]
    t1 = next(x for x in c.get(f"/api/v1/jobs/{jid}/candidates", headers=H("scheduler")).json() if x["id"] == w.uid["tech1"])
    assert 2.8 < t1["distance_km"] < 3.2
    assert t1["eta_min_estimate"] == round(t1["distance_km"] * 1.4 / 25 * 60)


def test_health_reports_database(c):
    assert c.get("/health").json()["database"] == "ok"


def test_api_can_serve_the_built_web_app_safely(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>")
    (dist / "logo.png").write_bytes(b"png")
    (dist / "assets" / "a.js").write_text("js")
    (tmp_path / "secret.txt").write_text("do not serve")
    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping():
        return {"ok": True}

    assert mount_frontend(app, dist) is True
    assert mount_frontend(FastAPI(), tmp_path / "missing") is False
    cl = TestClient(app)
    assert cl.get("/api/v1/ping").json() == {"ok": True}                      # API routes win
    assert cl.get("/api/v1/nope").status_code == 404                         # unknown API path is not the app shell
    assert cl.get("/").text == "<html>app</html>"
    assert cl.get("/m/job/123").text == "<html>app</html>"                   # client-side route
    assert cl.get("/logo.png").content == b"png" and cl.get("/assets/a.js").text == "js"
    for sneaky in ("/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"):
        assert "do not serve" not in cl.get(sneaky).text
