"""Job lifecycle. Every status change goes through _apply(): server-side validation, event row, audit row, SLA recompute."""
import json
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import func, select, case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import (
    Job, JobAssignment, JobEvent, JobEvidence, WorkReport, AtmDevice, IncidentCategory, User, Bank,
    Notification, Shift,
)
from ..realtime import STAFF_ROLES
from ..security import require, can
from ..timeutil import now, aware, iso
from . import sla, gps, performance
from .core import audit, emit, get_owned, get_setting, notify

HOLD_REASONS = ("spare_part_unavailable", "site_access_delay", "connectivity_issue",
                "awaiting_bank_confirmation", "other")
RESOLUTIONS = ("repaired", "part_replaced", "configuration_reset", "no_fault_found", "escalated_to_vendor")
OPEN_WORK = {"NOTIFIED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "ON_HOLD", "VERIFICATION", "RESOLVED", "ASSIGNED"}
REASSIGNABLE = {"ASSIGNED", "NOTIFIED", "ACCEPTED", "REJECTED", "EN_ROUTE", "ON_HOLD"}
PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
# Dispatch ETA heuristic: urban roads are ~1.4x the straight-line distance; 25 km/h average in city traffic.
ROAD_FACTOR = 1.4
CITY_KMH = 25


# ---------------------------------------------------------------- helpers
def _assignee_only(job: Job, actor: User) -> None:
    if actor.role != "technician" or job.assigned_to != actor.id:
        raise HTTPException(403, "Only the assigned technician can do this")


def _need(job: Job, allowed: set[str], action: str) -> None:
    if job.status not in allowed:
        raise HTTPException(409, f"Cannot {action}: job is {job.status}")


def _reason(text: str | None, what: str) -> str:
    t = (text or "").strip()
    if len(t) < 3:
        raise HTTPException(422, f"{what} is required")
    return t


def _clamp_occurred(db: Session, job: Job, occurred_at):
    n = now()
    occ = aware(occurred_at) or n
    if occ > n + timedelta(seconds=60):
        occ = n
    last = db.scalar(select(func.max(JobEvent.occurred_at)).where(JobEvent.job_id == job.id))
    if last and occ < aware(last):
        occ = aware(last)
    return occ


def _apply(db: Session, job: Job, actor: User | None, event_type: str, to_status: str, note: str | None = None,
           occurred_at=None) -> None:
    frm = job.status
    occ = _clamp_occurred(db, job, occurred_at)
    job.status = to_status
    job.updated_at = now()
    db.add(JobEvent(company_id=job.company_id, job_id=job.id, event_type=event_type, from_status=frm,
                    to_status=to_status, actor_id=actor.id if actor else None, note=note, occurred_at=occ))
    audit(db, actor, f"job.{event_type}", "job", job.id, {"status": frm}, {"status": to_status, "note": note},
          company_id=job.company_id)
    db.flush()
    sla.compute(db, job)
    emit(db, job.company_id, {"type": "job.updated", "job_id": job.id, "code": job.code, "status": to_status},
         roles=STAFF_ROLES, user_ids={job.assigned_to} if job.assigned_to else None)


def _dispatchers(db: Session, company_id: str) -> list[str]:
    return list(db.scalars(select(User.id).where(User.company_id == company_id, User.is_active.is_(True),
                                                  User.role.in_(["scheduler", "supervisor"]))))


def _next_code(db: Session, company_id: str) -> str:
    year = now().year
    prefix = f"J-{year}-"
    last = db.scalar(select(func.max(Job.code)).where(Job.company_id == company_id, Job.code.like(prefix + "%")))
    seq = int(last.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


# ---------------------------------------------------------------- create / read
def create_job(db: Session, actor: User, device_id: str, category_id: str | None, priority: str,
               description: str) -> Job:
    require(actor, "jobs:create")
    device = get_owned(db, AtmDevice, device_id, actor.company_id)
    cat = get_owned(db, IncidentCategory, category_id, actor.company_id) if category_id else None
    policy = sla.pick_policy(db, actor.company_id, priority, device.bank_id, cat.id if cat else None, device.device_type)
    for attempt in range(3):
        try:
            with db.begin_nested():
                job = Job(company_id=actor.company_id, code=_next_code(db, actor.company_id), device_id=device.id,
                          bank_id=device.bank_id, category_id=cat.id if cat else None, priority=priority,
                          status="CREATED", description=description.strip(), created_by=actor.id,
                          sla_policy_id=policy.id if policy else None, created_at=now())
                db.add(job)
                db.flush()
            break
        except IntegrityError:
            if attempt == 2:
                raise HTTPException(409, "Could not allocate job number, retry")
    db.add(JobEvent(company_id=job.company_id, job_id=job.id, event_type="created", from_status=None,
                    to_status="CREATED", actor_id=actor.id, note=None, occurred_at=job.created_at))
    audit(db, actor, "job.created", "job", job.id, None, {"code": job.code, "priority": priority, "device": device.code})
    db.flush()
    sla.compute(db, job)
    emit(db, job.company_id, {"type": "job.created", "job_id": job.id, "code": job.code, "priority": priority},
         roles=STAFF_ROLES)
    if priority == "critical":
        notify(db, job.company_id, _dispatchers(db, job.company_id), "job_created",
               f"Critical job {job.code}", f"{device.code}: {job.description[:120]}", "critical", job.id)
    return job


def get_job(db: Session, actor: User, job_id: str) -> Job:
    job = get_owned(db, Job, job_id, actor.company_id)
    if actor.role == "technician":
        if job.assigned_to != actor.id:
            raise HTTPException(404, "Job not found")  # do not reveal other technicians' jobs
    else:
        require(actor, "jobs:read")
    return job


def serialize(db: Session, jobs: list[Job], detail: bool = False) -> list[dict]:
    dev_ids = {j.device_id for j in jobs}
    devices = {d.id: d for d in db.scalars(select(AtmDevice).where(AtmDevice.id.in_(dev_ids)))} if dev_ids else {}
    banks = {b.id: b for b in db.scalars(select(Bank).where(Bank.id.in_({d.bank_id for d in devices.values()})))} if devices else {}
    cat_ids = {j.category_id for j in jobs if j.category_id}
    cats = {c.id: c for c in db.scalars(select(IncidentCategory).where(IncidentCategory.id.in_(cat_ids)))} if cat_ids else {}
    user_ids = {j.assigned_to for j in jobs if j.assigned_to}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}
    live_all = sla.compute_many(db, jobs)
    out = []
    for j in jobs:
        d = devices.get(j.device_id)
        live = live_all[j.id]
        row = {
            "id": j.id, "code": j.code, "status": j.status, "priority": j.priority, "description": j.description,
            "created_at": iso(j.created_at), "updated_at": iso(j.updated_at), "closed_at": iso(j.closed_at),
            "hold_reason": j.hold_reason, "correction_count": j.correction_count,
            "device": {"id": d.id, "code": d.code, "type": d.device_type, "address": d.address, "lat": d.lat,
                       "lon": d.lon, "status": d.status, "model": d.model,
                       "bank": banks[d.bank_id].name if d.bank_id in banks else None} if d else None,
            "category": {"id": cats[j.category_id].id, "name": cats[j.category_id].name} if j.category_id in cats else None,
            "assignee": {"id": users[j.assigned_to].id, "full_name": users[j.assigned_to].full_name} if j.assigned_to in users else None,
            "sla": {"state": live["state"], "due_at": live["due_at"], "remaining_seconds": live["remaining_seconds"],
                    "stopped": live["stopped"]},
        }
        if detail:
            row["sla"] = live
            row["assignments"] = [
                {"technician_id": a.technician_id, "status": a.status, "assigned_at": iso(a.assigned_at),
                 "responded_at": iso(a.responded_at), "reason": a.reason}
                for a in db.scalars(select(JobAssignment).where(JobAssignment.job_id == j.id).order_by(JobAssignment.assigned_at))]
            row["events"] = events(db, j)
            rep = latest_report(db, j)
            row["report"] = rep
            row["evidence"] = [evidence_meta(e) for e in db.scalars(select(JobEvidence).where(JobEvidence.job_id == j.id).order_by(JobEvidence.created_at))]
        out.append(row)
    return out


def events(db: Session, job: Job) -> list[dict]:
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == job.company_id))}
    return [{"id": e.id, "type": e.event_type, "from": e.from_status, "to": e.to_status, "note": e.note,
             "actor": names.get(e.actor_id), "occurred_at": iso(e.occurred_at), "recorded_at": iso(e.created_at)}
            for e in db.scalars(select(JobEvent).where(JobEvent.job_id == job.id).order_by(JobEvent.occurred_at, JobEvent.created_at))]


def evidence_meta(e: JobEvidence) -> dict:
    return {"id": e.id, "kind": e.kind, "mime": e.mime, "size": e.size, "original_name": e.original_name,
            "created_at": iso(e.created_at), "uploader_id": e.uploader_id}


def latest_report(db: Session, job: Job) -> dict | None:
    r = db.scalar(select(WorkReport).where(WorkReport.job_id == job.id).order_by(WorkReport.version.desc()).limit(1))
    if not r:
        return None
    return {"id": r.id, "version": r.version, "resolution": r.resolution, "notes": r.notes,
            "checklist": json.loads(r.checklist_json or "[]"), "parts_used": r.parts_used,
            "technician_id": r.technician_id, "submitted_at": iso(r.submitted_at)}


def list_jobs(db: Session, actor: User, *, status=None, priority=None, assignee=None, device_id=None, q=None,
              date_from=None, date_to=None, sort="-created_at", page=1, page_size=25) -> dict:
    require(actor, "jobs:read")
    stmt = select(Job).where(Job.company_id == actor.company_id)
    if status:
        stmt = stmt.where(Job.status.in_([s.strip().upper() for s in status.split(",")]))
    if priority:
        stmt = stmt.where(Job.priority.in_(priority.split(",")))
    if assignee:
        stmt = stmt.where(Job.assigned_to == assignee)
    if device_id:
        stmt = stmt.where(Job.device_id == device_id)
    if date_from:
        stmt = stmt.where(Job.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Job.created_at <= date_to)
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(Job.code.ilike(like, escape="\\") | Job.description.ilike(like, escape="\\")
                          | Job.device_id.in_(select(AtmDevice.id).where(AtmDevice.company_id == actor.company_id,
                                                                        AtmDevice.code.ilike(like, escape="\\"))))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    prio = case({k: v for k, v in PRIORITY_ORDER.items()}, value=Job.priority, else_=9)
    order = {"created_at": Job.created_at.asc(), "-created_at": Job.created_at.desc(), "priority": prio.asc(),
             "status": Job.status.asc()}.get(sort, Job.created_at.desc())
    page_size = max(1, min(page_size, 100))
    rows = list(db.scalars(stmt.order_by(order).offset((max(page, 1) - 1) * page_size).limit(page_size)))
    return {"total": total, "page": page, "page_size": page_size, "items": serialize(db, rows)}


def my_jobs(db: Session, actor: User, scope: str = "active") -> list[dict]:
    stmt = select(Job).where(Job.company_id == actor.company_id, Job.assigned_to == actor.id)
    if scope == "active":
        stmt = stmt.where(Job.status.notin_(["CLOSED", "CANCELLED"]))
    else:
        stmt = stmt.where(Job.status.in_(["CLOSED", "CANCELLED", "RESOLVED", "VERIFICATION"]))
    return serialize(db, list(db.scalars(stmt.order_by(Job.updated_at.desc()).limit(100))))


# ---------------------------------------------------------------- dispatch
def workload(db: Session, company_id: str) -> dict[str, int]:
    rows = db.execute(select(Job.assigned_to, func.count()).where(
        Job.company_id == company_id, Job.assigned_to.isnot(None),
        Job.status.in_(["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "ON_HOLD", "NOTIFIED", "ASSIGNED"])
    ).group_by(Job.assigned_to)).all()
    return {r[0]: r[1] for r in rows}


def candidates(db: Session, actor: User, job_id: str) -> list[dict]:
    require(actor, "jobs:assign")
    job = get_owned(db, Job, job_id, actor.company_id)
    device = db.get(AtmDevice, job.device_id)
    techs = list(db.scalars(select(User).where(User.company_id == actor.company_id, User.role == "technician",
                                               User.is_active.is_(True))))
    load = workload(db, actor.company_id)
    on_shift = {s.user_id for s in db.scalars(select(Shift).where(Shift.company_id == actor.company_id, Shift.status == "active"))}
    pos = gps.latest_positions(db, actor.company_id) if can(actor, "gps:read_live") else {}
    out = []
    for t in techs:
        skills = json.loads(t.skills or "[]")
        p = pos.get(t.id)
        dist = None
        if p and device and device.lat is not None and not p["stale"]:
            dist = round(gps.haversine_km(p["lat"], p["lon"], device.lat, device.lon), 2)
        n_active = load.get(t.id, 0)
        availability = "off_shift" if t.id not in on_shift else ("busy" if n_active else "available")
        out.append({
            "id": t.id, "full_name": t.full_name, "availability": availability, "active_jobs": n_active,
            "skills": skills, "skill_match": bool(device and device.device_type in skills),
            "distance_km": dist,
            # an estimate, not a route: straight line x ROAD_FACTOR at CITY_KMH
            "eta_min_estimate": max(1, round(dist * ROAD_FACTOR / CITY_KMH * 60)) if dist is not None else None,
            "location": {"lat": p["lat"], "lon": p["lon"], "age_s": p["age_s"], "stale": p["stale"]} if p else None,
            "is_current": t.id == job.assigned_to,
        })
    order = {"available": 0, "busy": 1, "off_shift": 2}
    out.sort(key=lambda c: (order[c["availability"]], not c["skill_match"], c["distance_km"] if c["distance_km"] is not None else 9e9, c["active_jobs"]))
    for i, c in enumerate(out):
        c["recommended"] = i == 0 and c["availability"] != "off_shift"
    return out


def _assign(db: Session, actor: User, job: Job, technician_id: str, event_type: str, note: str | None) -> Job:
    tech = get_owned(db, User, technician_id, actor.company_id)
    if tech.role != "technician" or not tech.is_active:
        raise HTTPException(422, "Selected user is not an active technician")
    for a in db.scalars(select(JobAssignment).where(JobAssignment.job_id == job.id, JobAssignment.status == "active")):
        a.status = "reassigned"
    db.add(JobAssignment(company_id=job.company_id, job_id=job.id, technician_id=tech.id, assigned_by=actor.id,
                         status="active", reason=note))
    old = job.assigned_to
    job.assigned_to = tech.id
    job.hold_reason = None
    _apply(db, job, actor, event_type, "ASSIGNED", note=f"to {tech.full_name}" + (f" — {note}" if note else ""))
    _apply(db, job, None, "notified", "NOTIFIED", note="in-app notification sent")
    d = db.get(AtmDevice, job.device_id)
    notify(db, job.company_id, [tech.id], "assignment", f"New job {job.code} ({job.priority})",
           f"{d.code if d else ''} — {job.description[:140]}", job.priority, job.id)
    emit(db, job.company_id, {"type": "assignment.new", "job_id": job.id, "priority": job.priority}, user_ids={tech.id})
    if old and old != tech.id:
        emit(db, job.company_id, {"type": "assignment.removed", "job_id": job.id}, user_ids={old})
    return job


def assign(db: Session, actor: User, job_id: str, technician_id: str, note: str | None = None) -> Job:
    require(actor, "jobs:assign")
    job = get_owned(db, Job, job_id, actor.company_id)
    _need(job, {"CREATED"}, "assign")
    return _assign(db, actor, job, technician_id, "assigned", note)


def reassign(db: Session, actor: User, job_id: str, technician_id: str, reason: str) -> Job:
    require(actor, "jobs:assign")
    job = get_owned(db, Job, job_id, actor.company_id)
    _need(job, REASSIGNABLE, "reassign")
    return _assign(db, actor, job, technician_id, "reassigned", _reason(reason, "Reassignment reason"))


def cancel(db: Session, actor: User, job_id: str, reason: str) -> Job:
    require(actor, "jobs:cancel")
    job = get_owned(db, Job, job_id, actor.company_id)
    if job.status in ("CLOSED", "CANCELLED"):
        raise HTTPException(409, f"Cannot cancel: job is {job.status}")
    prev = job.assigned_to
    _apply(db, job, actor, "cancelled", "CANCELLED", note=_reason(reason, "Cancellation reason"))
    job.closed_at = now()
    if prev:
        notify(db, job.company_id, [prev], "job_cancelled", f"Job {job.code} cancelled", reason, job.priority, job.id)
    return job


# ---------------------------------------------------------------- technician actions
def accept(db, actor, job_id, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"NOTIFIED"}, "accept")
    a = db.scalar(select(JobAssignment).where(JobAssignment.job_id == job.id, JobAssignment.status == "active"))
    if a:
        a.responded_at = now()
    _apply(db, job, actor, "accepted", "ACCEPTED", occurred_at=occurred_at)
    return job


def reject(db, actor, job_id, reason, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"NOTIFIED"}, "reject")
    reason = _reason(reason, "Rejection reason")
    a = db.scalar(select(JobAssignment).where(JobAssignment.job_id == job.id, JobAssignment.status == "active"))
    if a:
        a.status, a.reason, a.responded_at = "rejected", reason, now()
    _apply(db, job, actor, "rejected", "REJECTED", note=reason, occurred_at=occurred_at)
    job.assigned_to = None
    notify(db, job.company_id, _dispatchers(db, job.company_id), "job_rejected",
           f"{actor.full_name} rejected {job.code}", reason, job.priority, job.id)
    return job


def start_journey(db, actor, job_id, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"ACCEPTED"}, "start journey")
    _apply(db, job, actor, "journey_started", "EN_ROUTE", occurred_at=occurred_at)
    return job


def arrive(db, actor, job_id, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"EN_ROUTE"}, "mark arrival")
    _apply(db, job, actor, "arrived", "ARRIVED", occurred_at=occurred_at)
    return job


def start_work(db, actor, job_id, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"ARRIVED"}, "start work")
    _apply(db, job, actor, "work_started", "IN_PROGRESS", occurred_at=occurred_at)
    return job


def hold(db, actor, job_id, reason_code, note=None, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"IN_PROGRESS"}, "put on hold")
    if reason_code not in HOLD_REASONS:
        raise HTTPException(422, f"reason_code must be one of {', '.join(HOLD_REASONS)}")
    if reason_code == "other":
        _reason(note, "A note is required when the reason is 'other'")
    job.hold_reason = reason_code
    _apply(db, job, actor, "on_hold", "ON_HOLD", note=f"{reason_code}" + (f": {note}" if note else ""), occurred_at=occurred_at)
    return job


def resume(db, actor, job_id, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"ON_HOLD"}, "resume")
    job.hold_reason = None
    _apply(db, job, actor, "resumed", "IN_PROGRESS", occurred_at=occurred_at)
    return job


def resolve(db, actor, job_id, resolution, notes, checklist, parts_used=None, occurred_at=None):
    job = get_job(db, actor, job_id)
    _assignee_only(job, actor)
    _need(job, {"IN_PROGRESS"}, "resolve")
    if resolution not in RESOLUTIONS:
        raise HTTPException(422, f"resolution must be one of {', '.join(RESOLUTIONS)}")
    if len((notes or "").strip()) < 5:
        raise HTTPException(422, "Service notes are required (min 5 characters)")
    if get_setting(db, job.company_id, "general").get("require_after_photo", True):
        has_after = db.scalar(select(func.count()).select_from(JobEvidence).where(JobEvidence.job_id == job.id, JobEvidence.kind == "after"))
        if not has_after:
            raise HTTPException(422, "At least one 'after' photo is required before resolving")
    version = (db.scalar(select(func.max(WorkReport.version)).where(WorkReport.job_id == job.id)) or 0) + 1
    db.add(WorkReport(company_id=job.company_id, job_id=job.id, technician_id=actor.id, resolution=resolution,
                      notes=notes.strip(), checklist_json=json.dumps(checklist or []), parts_used=parts_used, version=version))
    _apply(db, job, actor, "resolved", "RESOLVED", note=resolution, occurred_at=occurred_at)
    _apply(db, job, None, "submitted_for_verification", "VERIFICATION", note="report submitted")
    notify(db, job.company_id, _dispatchers(db, job.company_id), "verification_needed",
           f"{job.code} awaiting verification", f"Resolution: {resolution}", job.priority, job.id)
    return job


# ---------------------------------------------------------------- scheduler verification
def verify(db, actor, job_id):
    require(actor, "jobs:verify")
    job = get_owned(db, Job, job_id, actor.company_id)
    _need(job, {"VERIFICATION"}, "close")
    _apply(db, job, actor, "verified_closed", "CLOSED", note="approved")
    job.closed_at = now()
    for a in db.scalars(select(JobAssignment).where(JobAssignment.job_id == job.id, JobAssignment.status == "active")):
        a.status = "completed"
    db.flush()
    performance.score_job(db, job)
    if job.assigned_to:
        notify(db, job.company_id, [job.assigned_to], "job_closed", f"{job.code} approved and closed", "", job.priority, job.id)
    return job


def request_correction(db, actor, job_id, reason):
    require(actor, "jobs:verify")
    job = get_owned(db, Job, job_id, actor.company_id)
    _need(job, {"VERIFICATION"}, "request correction")
    job.correction_count = (job.correction_count or 0) + 1
    _apply(db, job, actor, "correction_requested", "IN_PROGRESS", note=_reason(reason, "Correction reason"))
    if job.assigned_to:
        notify(db, job.company_id, [job.assigned_to], "correction_requested", f"Correction needed on {job.code}",
               reason, "high", job.id)
    return job


# ---------------------------------------------------------------- escalation / reminders
def escalation_sweep(db: Session, company_id: str) -> dict:
    rules = get_setting(db, company_id, "notification_rules")
    n = now()
    escalated = reminded = 0
    for job in db.scalars(select(Job).where(Job.company_id == company_id, Job.status == "NOTIFIED")):
        evs = list(db.scalars(select(JobEvent).where(JobEvent.job_id == job.id).order_by(JobEvent.occurred_at)))
        notified_at = next((aware(e.occurred_at) for e in reversed(evs) if e.to_status == "NOTIFIED"), None)
        if not notified_at:
            continue
        waited = (n - notified_at).total_seconds() / 60
        if waited >= rules["accept_timeout_min"] and not any(e.event_type == "escalation" and aware(e.occurred_at) >= notified_at for e in evs):
            db.add(JobEvent(company_id=company_id, job_id=job.id, event_type="escalation", from_status="NOTIFIED",
                            to_status="NOTIFIED", note=f"no response after {rules['accept_timeout_min']} min", occurred_at=n))
            audit(db, None, "job.escalation", "job", job.id, None, {"waited_min": round(waited, 1)}, company_id=company_id)
            targets = list(db.scalars(select(User.id).where(User.company_id == company_id, User.is_active.is_(True),
                                                            User.role.in_(rules["escalate_to_roles"]))))
            notify(db, company_id, targets, "escalation", f"No response on {job.code}",
                   f"Technician has not responded for {round(waited)} min", "critical", job.id)
            escalated += 1
        elif job.assigned_to:
            last = db.scalar(select(func.max(Notification.created_at)).where(
                Notification.job_id == job.id, Notification.user_id == job.assigned_to,
                Notification.kind.in_(["assignment", "reminder"])))
            if last and (n - aware(last)).total_seconds() / 60 >= rules["repeat_interval_min"]:
                notify(db, company_id, [job.assigned_to], "reminder", f"Reminder: {job.code} awaits your response", "", job.priority, job.id)
                reminded += 1
    db.commit()
    return {"escalated": escalated, "reminded": reminded}
