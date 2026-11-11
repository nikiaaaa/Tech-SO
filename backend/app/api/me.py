"""Endpoints for the signed-in user (mainly the technician mobile app) and notifications."""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Job, Notification, Shift, User
from ..schemas import MePatch, PingIn, SyncIn
from ..security import current_user, hash_password, validate_password_strength, verify_password
from ..services import gps, jobs as jobs_svc, performance, sync as sync_svc
from ..services.core import audit
from ..timeutil import now, aware, iso
from .auth import user_out

router = APIRouter(tags=["me"])


def _tech(user: User) -> None:
    if user.role != "technician":
        raise HTTPException(403, "Technician-only endpoint")


@router.get("/me")
def get_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_out(db, user)


@router.patch("/me")
def patch_me(body: MePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.phone is not None:
        user.phone = body.phone
    if body.password:
        if not body.current_password or not verify_password(body.current_password, user.password_hash):
            raise HTTPException(403, "Current password is incorrect")
        validate_password_strength(body.password)
        user.password_hash = hash_password(body.password)
        audit(db, user, "auth.password_changed", "user", user.id)
    db.commit()
    return user_out(db, user)


@router.get("/me/jobs")
def my_jobs(scope: str = "active", user: User = Depends(current_user), db: Session = Depends(get_db)):
    _tech(user)
    return jobs_svc.my_jobs(db, user, scope)


def _shift_out(s: Shift | None):
    return None if not s else {"id": s.id, "status": s.status, "starts_at": iso(s.starts_at), "ends_at": iso(s.ends_at),
                               "started_at": iso(s.started_at), "ended_at": iso(s.ended_at)}


@router.get("/me/shift")
def my_shift(user: User = Depends(current_user), db: Session = Depends(get_db)):
    _tech(user)
    return {"shift": _shift_out(gps.active_shift(db, user)), "tracking": gps.tracking_state(db, user)}


@router.post("/me/shift/start")
def start_shift(user: User = Depends(current_user), db: Session = Depends(get_db)):
    _tech(user)
    if gps.active_shift(db, user):
        raise HTTPException(409, "Shift already active")
    n = now()
    s = db.scalar(select(Shift).where(Shift.user_id == user.id, Shift.company_id == user.company_id, Shift.status == "planned",
                                      Shift.starts_at <= n + timedelta(hours=2), Shift.ends_at >= n).order_by(Shift.starts_at))
    if not s:  # ad-hoc shift: 8h unless the technician ends it earlier
        s = Shift(company_id=user.company_id, user_id=user.id, starts_at=n, ends_at=n + timedelta(hours=8))
        db.add(s)
    s.status, s.started_at = "active", n
    audit(db, user, "shift.started", "shift", s.id)
    db.commit()
    return {"shift": _shift_out(s), "tracking": gps.tracking_state(db, user)}


@router.post("/me/shift/end")
def end_shift(user: User = Depends(current_user), db: Session = Depends(get_db)):
    _tech(user)
    s = gps.active_shift(db, user)
    if not s:
        raise HTTPException(409, "No active shift")
    busy = db.scalar(select(Job).where(Job.company_id == user.company_id, Job.assigned_to == user.id,
                                       Job.status.in_(["EN_ROUTE", "ARRIVED", "IN_PROGRESS"])))
    if busy:
        raise HTTPException(409, f"Finish or put job {busy.code} on hold before ending your shift")
    s.status, s.ended_at = "ended", now()
    audit(db, user, "shift.ended", "shift", s.id)
    db.commit()
    return {"shift": _shift_out(s), "tracking": gps.tracking_state(db, user)}


@router.get("/me/tracking")
def tracking(user: User = Depends(current_user), db: Session = Depends(get_db)):
    _tech(user)
    return gps.tracking_state(db, user)


@router.post("/me/location")
def location(body: PingIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    res = gps.record_ping(db, user, body.lat, body.lon, body.accuracy_m, body.recorded_at, body.job_id)
    db.commit()
    return res


@router.post("/sync")
def sync(body: SyncIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _tech(user)
    return {"results": sync_svc.process(db, user, body.actions)}


@router.get("/me/performance")
def my_performance(period: str = "30d", user: User = Depends(current_user), db: Session = Depends(get_db)):
    _tech(user)
    return performance.technician_detail(db, user, user.id, period)


# ---- notifications (in-app; works for every role)
def _notif(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "priority": n.priority, "job_id": n.job_id,
            "created_at": iso(n.created_at), "read": n.read_at is not None}


@router.get("/notifications")
def notifications(unread_only: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Notification).where(Notification.user_id == user.id, Notification.company_id == user.company_id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = list(db.scalars(stmt.order_by(Notification.created_at.desc()).limit(100)))
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)))
    return {"unread": unread, "items": [_notif(n) for n in rows]}


@router.post("/notifications/{nid}/read")
def read_notification(nid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.scalar(select(Notification).where(Notification.id == nid, Notification.user_id == user.id))
    if not n:
        raise HTTPException(404, "Notification not found")
    n.read_at = n.read_at or now()
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    for n in db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))):
        n.read_at = now()
    db.commit()
    return {"ok": True}
