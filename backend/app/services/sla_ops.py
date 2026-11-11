"""SLA monitoring views and the pause workflow (request -> approval by someone else -> audited)."""
from collections import defaultdict
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Job, SlaPause, User
from ..security import require
from ..timeutil import now, iso
from . import sla, jobs as jobs_svc
from .core import audit, get_owned, notify

OPEN = ("CREATED", "ASSIGNED", "NOTIFIED", "ACCEPTED", "REJECTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "VERIFICATION")


def summary(db: Session, actor: User) -> dict:
    require(actor, "sla:read")
    open_jobs = list(db.scalars(select(Job).where(Job.company_id == actor.company_id, Job.status.in_(OPEN))))
    counts: dict[str, int] = defaultdict(int)
    seg_stats: dict[str, list] = defaultdict(list)
    for live in sla.compute_many(db, open_jobs).values():
        counts[live["state"]] += 1
        for name, s in live["segments"].items():
            if s["done"] and s["seconds"] is not None:
                seg_stats[name].append(s["seconds"])
    closed = list(db.scalars(select(Job).where(Job.company_id == actor.company_id, Job.status == "CLOSED").order_by(Job.closed_at.desc()).limit(200)))
    for live in sla.compute_many(db, closed).values():
        for name, s in live["segments"].items():
            if s["seconds"] is not None:
                seg_stats[name].append(s["seconds"])
    return {"open_by_state": dict(counts), "open_total": len(open_jobs),
            "avg_segment_minutes": {k: round(sum(v) / len(v) / 60, 1) for k, v in seg_stats.items() if v},
            "note": "Averages use up to 200 recently closed jobs plus completed segments of open jobs."}


def jobs_by_state(db: Session, actor: User, state: str | None) -> list[dict]:
    require(actor, "sla:read")
    jobs = list(db.scalars(select(Job).where(Job.company_id == actor.company_id, Job.status.in_(OPEN))))
    rows = jobs_svc.serialize(db, jobs)
    if state:
        rows = [r for r in rows if r["sla"]["state"] == state]
    rows.sort(key=lambda r: (r["sla"]["remaining_seconds"] is None, r["sla"]["remaining_seconds"] or 0))
    return rows


def _approvers(db: Session, company_id: str) -> list[str]:
    return list(db.scalars(select(User.id).where(User.company_id == company_id, User.is_active.is_(True),
                                                  User.role.in_(["supervisor", "management"]))))


def request_pause(db: Session, actor: User, job_id: str, reason: str) -> SlaPause:
    require(actor, "sla:pause_request")
    job = get_owned(db, Job, job_id, actor.company_id)
    if job.status in ("CLOSED", "CANCELLED"):
        raise HTTPException(409, "Job is already finished")
    if len((reason or "").strip()) < 10:
        raise HTTPException(422, "A documented reason is required (min 10 characters)")
    if db.scalar(select(SlaPause).where(SlaPause.job_id == job.id, SlaPause.status.in_(["pending", "approved"]))):
        raise HTTPException(409, "This job already has an open pause request")
    p = SlaPause(company_id=actor.company_id, job_id=job.id, requested_by=actor.id, reason=reason.strip())
    db.add(p)
    db.flush()
    audit(db, actor, "sla.pause_requested", "sla_pause", p.id, None, {"job": job.code, "reason": reason})
    notify(db, actor.company_id, _approvers(db, actor.company_id), "sla_pause_request",
           f"SLA pause requested for {job.code}", reason[:140], "high", job.id)
    return p


def decide_pause(db: Session, actor: User, pause_id: str, approve: bool, note: str) -> SlaPause:
    require(actor, "sla:pause_approve")
    p = get_owned(db, SlaPause, pause_id, actor.company_id)
    if p.status != "pending":
        raise HTTPException(409, "Request already decided")
    if p.requested_by == actor.id:
        raise HTTPException(403, "You cannot approve your own pause request")
    if len((note or "").strip()) < 3:
        raise HTTPException(422, "A decision note is required")
    p.status = "approved" if approve else "rejected"
    p.decided_by, p.decision_note = actor.id, note.strip()
    if approve:
        p.started_at = now()
    job = db.get(Job, p.job_id)
    audit(db, actor, "sla.pause_decided", "sla_pause", p.id, {"status": "pending"}, {"status": p.status, "note": note})
    db.flush()
    sla.compute(db, job)
    notify(db, actor.company_id, [p.requested_by], "sla_pause_decision", f"SLA pause {p.status} for {job.code}", note[:140], "medium", job.id)
    return p


def end_pause(db: Session, actor: User, pause_id: str) -> SlaPause:
    require(actor, "sla:pause_approve")
    p = get_owned(db, SlaPause, pause_id, actor.company_id)
    if p.status != "approved":
        raise HTTPException(409, "Only an active (approved) pause can be ended")
    p.status, p.ended_at = "ended", now()
    audit(db, actor, "sla.pause_ended", "sla_pause", p.id, {"status": "approved"}, {"status": "ended"})
    db.flush()
    sla.compute(db, db.get(Job, p.job_id))
    return p


def list_pauses(db: Session, actor: User, status: str | None = None) -> list[dict]:
    require(actor, "sla:read")
    stmt = select(SlaPause).where(SlaPause.company_id == actor.company_id)
    if status:
        stmt = stmt.where(SlaPause.status == status)
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == actor.company_id))}
    codes = {j.id: j.code for j in db.scalars(select(Job).where(Job.company_id == actor.company_id))}
    return [{"id": p.id, "job_id": p.job_id, "job_code": codes.get(p.job_id), "requested_by": names.get(p.requested_by),
             "reason": p.reason, "status": p.status, "decided_by": names.get(p.decided_by), "decision_note": p.decision_note,
             "started_at": iso(p.started_at), "ended_at": iso(p.ended_at), "created_at": iso(p.created_at)}
            for p in db.scalars(stmt.order_by(SlaPause.created_at.desc()).limit(200))]
