"""GPS policy: who may report, who may read, throttling, validation, retention."""
from datetime import timedelta

from app.db import SessionLocal
from app.models import LocationPing
from app.services import gps
from app.timeutil import now
from tests.conftest import drive, start_shift

PING = {"lat": -6.2100, "lon": 106.8450, "accuracy_m": 12}


def ping(c, H, who="tech1", **over):
    return c.post("/api/v1/me/location", headers=H(who), json={**PING, **over})


def test_no_tracking_without_shift_or_assignment(c, w, H):
    assert ping(c, H).status_code == 403
    assert c.get("/api/v1/me/tracking", headers=H("tech1")).json()["active"] is False


def test_tracking_starts_with_shift_and_stops_when_it_ends(c, w, H):
    start_shift(c, H)
    assert c.get("/api/v1/me/tracking", headers=H("tech1")).json() == {**c.get("/api/v1/me/tracking", headers=H("tech1")).json(), "active": True, "reason": "active_shift"}
    assert ping(c, H).json() == {"accepted": True}
    assert c.post("/api/v1/me/shift/end", headers=H("tech1")).status_code == 200
    assert ping(c, H, lat=-6.2111).status_code == 403


def test_active_assignment_authorizes_tracking_without_a_shift(c, w, H):
    jid = drive(c, H, w, "accept", "tech1")
    state = c.get("/api/v1/me/tracking", headers=H("tech1")).json()
    assert state["active"] and state["reason"] == "active_assignment" and state["job_id"] == jid
    assert ping(c, H, job_id=jid).json()["accepted"] is True


def test_cannot_end_shift_while_travelling_or_working(c, w, H):
    start_shift(c, H)
    drive(c, H, w, "start-journey", "tech1")
    assert c.post("/api/v1/me/shift/end", headers=H("tech1")).status_code == 409


def test_ping_validation_throttle_and_accuracy(c, w, H):
    start_shift(c, H)
    assert ping(c, H, lat=0, lon=0).status_code == 422          # "null island" is not a position
    assert ping(c, H, lat=91).status_code == 422
    assert ping(c, H, lon=-181).status_code == 422
    assert ping(c, H, accuracy_m=5000).json() == {"accepted": False, "reason": "accuracy_too_low", "accuracy_m": 5000}
    assert ping(c, H).json()["accepted"] is True
    assert ping(c, H).json() == {"accepted": False, "reason": "throttled"}   # inside the minimum interval
    assert ping(c, H, job_id="not-a-real-job").status_code in (403, 404)


def test_ping_rejects_a_job_that_is_not_yours(c, w, H):
    start_shift(c, H, "tech2")
    other = drive(c, H, w, "assign", "tech1")
    assert ping(c, H, "tech2", job_id=other).status_code == 403


def test_only_technicians_report_and_only_dispatch_roles_read(c, w, H):
    start_shift(c, H)
    ping(c, H)
    assert ping(c, H, "scheduler").status_code == 403
    assert c.get("/api/v1/technicians/live", headers=H("tech2")).status_code == 403
    live = c.get("/api/v1/technicians/live", headers=H("scheduler")).json()
    assert len(live) == 1 and live[0]["id"] == w.uid["tech1"] and live[0]["location"]["lat"] == PING["lat"]
    assert c.get("/api/v1/technicians/live", headers=H("b_sched")).json() == []        # other tenant sees nothing
    listing = c.get("/api/v1/technicians", headers=H("scheduler")).json()
    assert all("location" in t for t in listing)
    assert c.get("/api/v1/technicians", headers=H("tech1")).status_code == 403


def test_future_and_stale_timestamps_are_not_trusted(c, w, H):
    start_shift(c, H)
    r = ping(c, H, recorded_at=(now() + timedelta(days=3)).isoformat())
    assert r.json()["accepted"] is True
    db = SessionLocal()
    stored = db.query(LocationPing).one()
    assert stored.recorded_at.replace(tzinfo=None) <= (now() + timedelta(seconds=5)).replace(tzinfo=None)
    db.close()


def test_candidates_use_real_positions_for_distance(c, w, H):
    start_shift(c, H)
    ping(c, H, lat=-6.2090, lon=106.8457)                 # about 20 m from ATM-A-1
    jid = c.post("/api/v1/jobs", headers=H("scheduler"), json={"device_id": w.dev, "priority": "high", "description": "distance check"}).json()["id"]
    cands = c.get(f"/api/v1/jobs/{jid}/candidates", headers=H("scheduler")).json()
    t1 = next(x for x in cands if x["id"] == w.uid["tech1"])
    t2 = next(x for x in cands if x["id"] == w.uid["tech2"])
    assert t1["distance_km"] is not None and t1["distance_km"] < 0.1 and t1["availability"] == "available" and t1["recommended"]
    assert t2["distance_km"] is None and t2["availability"] == "off_shift"          # no position and no shift: nothing is invented
    assert c.get(f"/api/v1/jobs/{jid}/candidates", headers=H("tech1")).status_code == 403


def test_haversine_matches_a_known_distance():
    # Jakarta Monas to Bundaran HI is about 2.2 km
    assert 1.9 < gps.haversine_km(-6.1754, 106.8272, -6.1950, 106.8230) < 2.5


def test_retention_purge_deletes_only_expired_pings(c, w, H):
    start_shift(c, H)
    ping(c, H)
    db = SessionLocal()
    db.add(LocationPing(company_id=w.A, user_id=w.uid["tech1"], lat=-6.2, lon=106.8, recorded_at=now() - timedelta(days=31)))
    db.commit()
    assert gps.purge_old(db, w.A) == 1                     # default retention is 30 days
    db.commit()
    assert db.query(LocationPing).count() == 1
    db.close()


def test_policy_can_disable_tracking(c, w, H):
    start_shift(c, H)
    r = c.put("/api/v1/settings/gps_policy", headers=H("admin"), json={"enabled": False, "min_interval_s": 10, "max_accuracy_m": 200,
                                                                         "stale_after_s": 300, "retention_days": 30})
    assert r.status_code == 200
    assert ping(c, H).status_code == 403
    assert c.get("/api/v1/settings/gps_policy", headers=H("tech1")).json()["enabled"] is False   # technician can read what is tracked
