"""Scheduler-side operations: technicians, live positions, shifts, devices, SLA monitoring, performance, reports."""
import csv
import io
import json
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AtmDevice, Bank, Branch, Job, Shift, TeamMember, Team, User
from ..schemas import (AppealDecisionIn, AppealIn, CsvImportIn, DecisionIn, DeviceIn, DevicePatch, PauseRequestIn,
                       ScoringIn, ShiftIn)
from ..security import current_user, require, can
from ..services import gps, jobs as jobs_svc, performance, reports, sla_ops
from ..services.core import audit, get_owned
from ..timeutil import now, iso
from ..services.jobs import escalation_sweep

router = APIRouter(tags=["operations"])


# ------------------------------------------------------------ overview / reports
@router.get("/overview")
def overview(range: str = "24h", user: User = Depends(current_user), db: Session = Depends(get_db)):
    return reports.overview(db, user, range)


@router.get("/reports/{kind}")
def report(kind: str, date_from: str | None = None, date_to: str | None = None,
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    return reports.build(db, user, kind, date_from, date_to)


@router.get("/reports/{kind}/export")
def report_export(kind: str, date_from: str | None = None, date_to: str | None = None,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = reports.build(db, user, kind, date_from, date_to)
    audit(db, user, "report.exported", "report", None, None, {"kind": kind})
    db.commit()
    return Response(reports.to_csv(data), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="techso-{kind}-report.csv"'})


# ------------------------------------------------------------ technicians
def _tech_row(t: User, load, on_shift, pos, teams, include_loc: bool) -> dict:
    n = load.get(t.id, 0)
    row = {"id": t.id, "full_name": t.full_name, "phone": t.phone, "skills": json.loads(t.skills or "[]"),
           "is_active": t.is_active, "active_jobs": n, "teams": teams.get(t.id, []),
           "status": "off_shift" if t.id not in on_shift else ("working" if n else "available")}
    if include_loc:
        row["location"] = pos.get(t.id)
    return row


def _tech_context(db: Session, user: User):
    load = jobs_svc.workload(db, user.company_id)
    on_shift = {s.user_id for s in db.scalars(select(Shift).where(Shift.company_id == user.company_id, Shift.status == "active"))}
    team_names = {t.id: t.name for t in db.scalars(select(Team).where(Team.company_id == user.company_id))}
    teams: dict[str, list] = {}
    for m in db.scalars(select(TeamMember).where(TeamMember.company_id == user.company_id)):
        teams.setdefault(m.user_id, []).append(team_names.get(m.team_id))
    can_loc = can(user, "gps:read_live")
    return load, on_shift, (gps.latest_positions(db, user.company_id) if can_loc else {}), teams, can_loc


@router.get("/technicians")
def technicians(q: str | None = None, status: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "technicians:read")
    ctx = _tech_context(db, user)
    stmt = select(User).where(User.company_id == user.company_id, User.role == "technician")
    if q:
        stmt = stmt.where(User.full_name.ilike("%" + q.replace("%", "").replace("_", "") + "%"))
    rows = [_tech_row(t, *ctx) for t in db.scalars(stmt.order_by(User.full_name))]
    return [r for r in rows if not status or r["status"] == status]


@router.get("/technicians/live")
def technicians_live(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "gps:read_live")
    ctx = _tech_context(db, user)
    pos = ctx[2]
    out = []
    for t in db.scalars(select(User).where(User.company_id == user.company_id, User.role == "technician", User.is_active.is_(True))):
        if t.id in pos:
            out.append({**_tech_row(t, *ctx), "location": pos[t.id]})
    return out


@router.get("/technicians/{tech_id}")
def technician(tech_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "technicians:read")
    t = get_owned(db, User, tech_id, user.company_id)
    if t.role != "technician":
        raise HTTPException(404, "Technician not found")
    row = _tech_row(t, *_tech_context(db, user))
    jobs = list(db.scalars(select(Job).where(Job.company_id == user.company_id, Job.assigned_to == t.id,
                                             Job.status.notin_(["CLOSED", "CANCELLED"])).limit(50)))
    row["jobs"] = jobs_svc.serialize(db, jobs)
    row["performance"] = performance.technician_summary(db, user.company_id, t.id, now() - timedelta(days=365))
    return row


def _shift_out(s: Shift, names) -> dict:
    return {"id": s.id, "user_id": s.user_id, "technician": names.get(s.user_id), "starts_at": iso(s.starts_at),
            "ends_at": iso(s.ends_at), "status": s.status, "started_at": iso(s.started_at), "ended_at": iso(s.ended_at)}


@router.get("/technicians/{tech_id}/shifts")
def tech_shifts(tech_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "technicians:read")
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == user.company_id))}
    get_owned(db, User, tech_id, user.company_id)
    return [_shift_out(s, names) for s in db.scalars(select(Shift).where(Shift.company_id == user.company_id, Shift.user_id == tech_id)
                                                     .order_by(Shift.starts_at.desc()).limit(60))]


@router.get("/shifts")
def shifts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "technicians:read")
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == user.company_id))}
    return [_shift_out(s, names) for s in db.scalars(select(Shift).where(Shift.company_id == user.company_id).order_by(Shift.starts_at.desc()).limit(200))]


@router.post("/shifts", status_code=201)
def create_shift(body: ShiftIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "shifts:manage")
    t = get_owned(db, User, body.user_id, user.company_id)
    if t.role != "technician":
        raise HTTPException(422, "Shifts are for technicians")
    if body.ends_at <= body.starts_at:
        raise HTTPException(422, "Shift must end after it starts")
    s = Shift(company_id=user.company_id, user_id=t.id, starts_at=body.starts_at, ends_at=body.ends_at)
    db.add(s)
    db.flush()
    audit(db, user, "shift.created", "shift", s.id, None, {"user": t.full_name})
    db.commit()
    return _shift_out(s, {t.id: t.full_name})


# ------------------------------------------------------------ devices
def _device_out(d: AtmDevice, banks, open_counts) -> dict:
    return {"id": d.id, "code": d.code, "device_type": d.device_type, "model": d.model, "address": d.address,
            "lat": d.lat, "lon": d.lon, "status": d.status, "bank_id": d.bank_id, "bank": banks.get(d.bank_id),
            "branch_id": d.branch_id, "open_jobs": open_counts.get(d.id, 0)}


def _device_ctx(db, user):
    banks = {b.id: b.name for b in db.scalars(select(Bank).where(Bank.company_id == user.company_id))}
    open_counts = dict(db.execute(select(Job.device_id, func.count()).where(
        Job.company_id == user.company_id, Job.status.notin_(["CLOSED", "CANCELLED"])).group_by(Job.device_id)).all())
    return banks, open_counts


@router.get("/devices")
def devices(q: str | None = None, device_type: str | None = None, bank_id: str | None = None, status: str | None = None,
            page: int = 1, page_size: int = 50, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:read")
    stmt = select(AtmDevice).where(AtmDevice.company_id == user.company_id)
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(AtmDevice.code.ilike(like, escape="\\") | AtmDevice.address.ilike(like, escape="\\"))
    if device_type:
        stmt = stmt.where(AtmDevice.device_type == device_type)
    if bank_id:
        stmt = stmt.where(AtmDevice.bank_id == bank_id)
    if status:
        stmt = stmt.where(AtmDevice.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    page_size = max(1, min(page_size, 200))
    ctx = _device_ctx(db, user)
    rows = db.scalars(stmt.order_by(AtmDevice.code).offset((max(page, 1) - 1) * page_size).limit(page_size))
    return {"total": total, "page": page, "page_size": page_size, "items": [_device_out(d, *ctx) for d in rows]}


@router.post("/devices", status_code=201)
def create_device(body: DeviceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:write")
    get_owned(db, Bank, body.bank_id, user.company_id)
    if body.branch_id:
        get_owned(db, Branch, body.branch_id, user.company_id)
    if db.scalar(select(AtmDevice).where(AtmDevice.company_id == user.company_id, AtmDevice.code == body.code)):
        raise HTTPException(409, "Device code already exists")
    d = AtmDevice(company_id=user.company_id, **body.model_dump())
    db.add(d)
    db.flush()
    audit(db, user, "device.created", "device", d.id, None, body.model_dump())
    db.commit()
    return _device_out(d, *_device_ctx(db, user))


@router.get("/devices/{device_id}")
def device(device_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:read")
    return _device_out(get_owned(db, AtmDevice, device_id, user.company_id), *_device_ctx(db, user))


@router.patch("/devices/{device_id}")
def patch_device(device_id: str, body: DevicePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:write")
    d = get_owned(db, AtmDevice, device_id, user.company_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("branch_id"):
        get_owned(db, Branch, changes["branch_id"], user.company_id)
    before = {k: getattr(d, k) for k in changes}
    for k, v in changes.items():
        setattr(d, k, v)
    audit(db, user, "device.updated", "device", d.id, before, changes)
    db.commit()
    return _device_out(d, *_device_ctx(db, user))


@router.get("/devices/{device_id}/jobs")
def device_jobs(device_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:read")
    get_owned(db, AtmDevice, device_id, user.company_id)
    return jobs_svc.list_jobs(db, user, device_id=device_id, page_size=50)


@router.post("/devices/import")
def import_devices(body: CsvImportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:write")
    banks = {b.code: b.id for b in db.scalars(select(Bank).where(Bank.company_id == user.company_id))}
    created, errors = 0, []
    for i, row in enumerate(csv.DictReader(io.StringIO(body.csv)), start=2):
        try:
            code, dtype = (row.get("code") or "").strip(), (row.get("device_type") or "").strip().upper()
            if not code or dtype not in ("ATM", "CRM") or (row.get("bank_code") or "").strip() not in banks:
                raise ValueError("code, device_type (ATM/CRM) and a known bank_code are required")
            if db.scalar(select(AtmDevice).where(AtmDevice.company_id == user.company_id, AtmDevice.code == code)):
                raise ValueError("device code already exists")
            lat = float(row["lat"]) if row.get("lat") else None
            lon = float(row["lon"]) if row.get("lon") else None
            if (lat is not None and not -90 <= lat <= 90) or (lon is not None and not -180 <= lon <= 180):
                raise ValueError("coordinates out of range")
            db.add(AtmDevice(company_id=user.company_id, bank_id=banks[row["bank_code"].strip()], code=code, device_type=dtype,
                             model=(row.get("model") or "")[:100] or None, address=(row.get("address") or "")[:255] or None, lat=lat, lon=lon))
            db.flush()
            created += 1
        except (ValueError, KeyError) as e:
            errors.append({"row": i, "error": str(e)})
    audit(db, user, "device.imported", "device", None, None, {"created": created, "errors": len(errors)})
    db.commit()
    return {"created": created, "errors": errors}


# ------------------------------------------------------------ SLA monitoring
@router.get("/sla/summary")
def sla_summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return sla_ops.summary(db, user)


@router.get("/sla/jobs")
def sla_jobs(state: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return sla_ops.jobs_by_state(db, user, state)


@router.get("/sla/pauses")
def sla_pauses(status: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return sla_ops.list_pauses(db, user, status)


@router.post("/sla/{job_id}/pause-request", status_code=201)
def pause_request(job_id: str, body: PauseRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = sla_ops.request_pause(db, user, job_id, body.reason)
    db.commit()
    return {"id": p.id, "status": p.status}


@router.post("/sla/pauses/{pause_id}/decision")
def pause_decision(pause_id: str, body: DecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = sla_ops.decide_pause(db, user, pause_id, body.approve, body.note)
    db.commit()
    return {"id": p.id, "status": p.status}


@router.post("/sla/pauses/{pause_id}/end")
def pause_end(pause_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = sla_ops.end_pause(db, user, pause_id)
    db.commit()
    return {"id": p.id, "status": p.status}


# ------------------------------------------------------------ performance
@router.get("/performance/team")
def perf_team(period: str = "30d", user: User = Depends(current_user), db: Session = Depends(get_db)):
    return performance.team_summary(db, user, period)


@router.get("/performance/appeals")
def perf_appeals(status: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return performance.list_appeals(db, user, status)


@router.post("/performance/scores/{score_id}/appeal", status_code=201)
def perf_appeal(score_id: str, body: AppealIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = performance.create_appeal(db, user, score_id, body.reason)
    db.commit()
    return {"id": a.id, "status": a.status}


@router.post("/performance/appeals/{appeal_id}/decision")
def perf_decide(appeal_id: str, body: AppealDecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = performance.decide_appeal(db, user, appeal_id, body.accept, body.note, body.new_total)
    db.commit()
    return {"id": a.id, "status": a.status}


@router.get("/performance/{tech_id}")
def perf_tech(tech_id: str, period: str = "30d", user: User = Depends(current_user), db: Session = Depends(get_db)):
    return performance.technician_detail(db, user, tech_id, period)


@router.get("/scoring-versions")
def scoring_versions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = performance.list_versions(db, user)
    db.commit()
    return out


@router.post("/scoring-versions", status_code=201)
def scoring_publish(body: ScoringIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = performance.create_version(db, user, body.weights, body.params, body.note)
    db.commit()
    return out


# ------------------------------------------------------------ admin utilities
@router.post("/admin/escalation/run")
def run_escalation(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "escalation:run")
    return escalation_sweep(db, user.company_id)
