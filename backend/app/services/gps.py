"""GPS policy enforcement. Location is accepted only from a technician who is on an active shift or holds an
authorized assignment, and is readable only by dispatch/management roles. A position is a hint, not proof of conduct."""
from datetime import datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import Job, LocationPing, Shift, User
from ..timeutil import now, aware
from .core import get_setting, emit

TRACKING_STATUSES = {"ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "ON_HOLD"}


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6371.0088 * asin(sqrt(a))


def active_shift(db: Session, user: User) -> Shift | None:
    return db.scalar(select(Shift).where(Shift.user_id == user.id, Shift.company_id == user.company_id,
                                         Shift.status == "active"))


def tracking_state(db: Session, user: User) -> dict:
    """What the technician UI must show: is tracking active, and why."""
    policy = get_setting(db, user.company_id, "gps_policy")
    if not policy["enabled"]:
        return {"active": False, "reason": "disabled_by_policy", "policy": policy}
    if active_shift(db, user):
        return {"active": True, "reason": "active_shift", "policy": policy}
    job = db.scalar(select(Job).where(Job.company_id == user.company_id, Job.assigned_to == user.id,
                                      Job.status.in_(TRACKING_STATUSES)))
    if job:
        return {"active": True, "reason": "active_assignment", "job_id": job.id, "policy": policy}
    return {"active": False, "reason": "no_active_shift_or_assignment", "policy": policy}


def record_ping(db: Session, user: User, lat: float, lon: float, accuracy_m: float | None,
                recorded_at: datetime | None, job_id: str | None = None) -> dict:
    if user.role != "technician":
        raise HTTPException(403, "Only technicians report location")
    state = tracking_state(db, user)
    if not state["active"]:
        raise HTTPException(403, f"Tracking not authorized: {state['reason']}")
    policy = state["policy"]

    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        raise HTTPException(422, "Invalid coordinates")
    n = now()
    rec = aware(recorded_at) or n
    if rec > n + timedelta(seconds=60) or rec < n - timedelta(hours=24):
        rec = n  # clock skew / stale device clock: fall back to receive time
    if accuracy_m is not None and accuracy_m > policy["max_accuracy_m"]:
        return {"accepted": False, "reason": "accuracy_too_low", "accuracy_m": accuracy_m}

    if job_id:
        job = db.scalar(select(Job).where(Job.id == job_id, Job.company_id == user.company_id, Job.assigned_to == user.id))
        if not job:
            raise HTTPException(403, "Job is not assigned to you")

    last = db.scalar(select(LocationPing).where(LocationPing.user_id == user.id).order_by(LocationPing.recorded_at.desc()).limit(1))
    if last and abs((rec - aware(last.recorded_at)).total_seconds()) < policy["min_interval_s"]:
        return {"accepted": False, "reason": "throttled"}

    db.add(LocationPing(company_id=user.company_id, user_id=user.id, job_id=job_id, lat=lat, lon=lon,
                        accuracy_m=accuracy_m, recorded_at=rec))
    emit(db, user.company_id,
         {"type": "location.update", "user_id": user.id, "lat": lat, "lon": lon, "accuracy_m": accuracy_m,
          "recorded_at": rec.isoformat()},
         roles={"super_admin", "management", "supervisor", "scheduler"})
    return {"accepted": True}


def latest_positions(db: Session, company_id: str, within_s: int = 1800) -> dict[str, dict]:
    """shortcut: scans the last `within_s` of pings in Python, fine to a few hundred technicians; use DISTINCT ON in PostgreSQL later."""
    stale_after = get_setting(db, company_id, "gps_policy")["stale_after_s"]
    since = now() - timedelta(seconds=within_s)
    out: dict[str, dict] = {}
    for p in db.scalars(select(LocationPing).where(LocationPing.company_id == company_id, LocationPing.recorded_at >= since)
                        .order_by(LocationPing.recorded_at.desc()).limit(5000)):
        if p.user_id in out:
            continue
        age = (now() - aware(p.recorded_at)).total_seconds()
        out[p.user_id] = {"lat": p.lat, "lon": p.lon, "accuracy_m": p.accuracy_m,
                          "recorded_at": aware(p.recorded_at).isoformat(), "age_s": int(age), "stale": age > stale_after}
    return out


def purge_old(db: Session, company_id: str) -> int:
    days = get_setting(db, company_id, "gps_policy")["retention_days"]
    res = db.execute(delete(LocationPing).where(LocationPing.company_id == company_id,
                                                LocationPing.recorded_at < now() - timedelta(days=days)))
    return res.rowcount or 0
