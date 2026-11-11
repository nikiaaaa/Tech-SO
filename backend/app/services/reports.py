"""Overview KPIs and tabular reports. All numbers are computed from stored jobs; nothing is estimated or invented."""
import csv
import io
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..models import AtmDevice, IncidentCategory, Job, JobEvent, Shift, User, Bank
from ..security import require
from ..timeutil import now, aware, iso
from . import sla, performance
from .sla_ops import OPEN

RANGES = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}


def overview(db: Session, actor: User, range_: str = "24h") -> dict:
    require(actor, "overview")
    since = now() - RANGES.get(range_, RANGES["24h"])
    cid = actor.company_id
    open_jobs = list(db.scalars(select(Job).where(Job.company_id == cid, Job.status.in_(OPEN))))
    state_counts: Counter = Counter()
    for live in sla.compute_many(db, open_jobs).values():
        state_counts[live["state"]] += 1
    working_ids = {j.assigned_to for j in open_jobs if j.status in ("ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "ON_HOLD") and j.assigned_to}
    on_shift = {s.user_id for s in db.scalars(select(Shift).where(Shift.company_id == cid, Shift.status == "active"))}
    techs = db.scalar(select(func.count()).select_from(User).where(User.company_id == cid, User.role == "technician", User.is_active.is_(True))) or 0
    resolved = db.scalar(select(func.count()).select_from(JobEvent).where(JobEvent.company_id == cid, JobEvent.to_status == "RESOLVED", JobEvent.occurred_at >= since)) or 0
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == cid))}
    recent = list(db.execute(select(JobEvent, Job.code).join(Job, Job.id == JobEvent.job_id)
                             .where(JobEvent.company_id == cid).order_by(JobEvent.created_at.desc()).limit(10)))
    total_open = len(open_jobs)
    on_track = state_counts.get("on_track", 0)
    return {
        "range": range_,
        "kpis": {
            "active_jobs": total_open,
            "unassigned": sum(1 for j in open_jobs if j.status in ("CREATED", "REJECTED")),
            "awaiting_acceptance": sum(1 for j in open_jobs if j.status == "NOTIFIED"),
            "technicians_available": len(on_shift - working_ids),
            "technicians_working": len(working_ids),
            "technicians_total": techs,
            "sla_warning": state_counts.get("warning", 0),
            "sla_breach": state_counts.get("breach", 0),
            "resolved": resolved,
            "critical_open": sum(1 for j in open_jobs if j.priority == "critical"),
        },
        "priority": dict(Counter(j.priority for j in open_jobs)),
        "sla": {"on_track": on_track, "warning": state_counts.get("warning", 0), "breach": state_counts.get("breach", 0),
                "no_policy": state_counts.get("no_policy", 0),
                "on_track_pct": round(100 * on_track / total_open, 1) if total_open else None},
        "recent_activity": [{"job_id": e.job_id, "job_code": code, "type": e.event_type, "to_status": e.to_status,
                             "actor": names.get(e.actor_id), "at": iso(e.created_at)} for e, code in recent],
    }


# ------------------------------------------------------------------ reports
def _range(date_from: str | None, date_to: str | None):
    try:
        f = datetime.fromisoformat(date_from).astimezone() if date_from else now() - timedelta(days=30)
        t = datetime.fromisoformat(date_to).astimezone() if date_to else now()
    except ValueError:
        raise HTTPException(422, "from/to must be ISO dates")
    return f, t


def build(db: Session, actor: User, kind: str, date_from: str | None, date_to: str | None) -> dict:
    require(actor, "reports:read")
    f, t = _range(date_from, date_to)
    cid = actor.company_id
    jobs = list(db.scalars(select(Job).where(Job.company_id == cid, Job.created_at >= f, Job.created_at <= t).order_by(Job.created_at.desc())))
    devices = {d.id: d for d in db.scalars(select(AtmDevice).where(AtmDevice.company_id == cid))}
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == cid))}
    live = sla.compute_many(db, jobs)

    if kind == "jobs":
        rows = [[j.code, devices[j.device_id].code, devices[j.device_id].device_type, j.priority, j.status, names.get(j.assigned_to, ""),
                 iso(j.created_at), iso(j.closed_at) or "", live[j.id]["state"],
                 round(live[j.id]["segments"]["total"]["seconds"] / 60, 1) if live[j.id]["segments"]["total"]["seconds"] is not None else ""] for j in jobs]
        return {"kind": kind, "columns": ["Job", "Device", "Type", "Priority", "Status", "Technician", "Created", "Closed", "SLA", "Total min"],
                "rows": rows, "summary": {"jobs": len(jobs)}}

    if kind == "sla":
        by_p: dict[str, dict] = defaultdict(lambda: {"jobs": 0, "within": 0, "breach": 0, "mins": []})
        for j in jobs:
            if j.status == "CANCELLED" or live[j.id]["state"] in ("no_policy", "cancelled"):
                continue
            b = by_p[j.priority]
            b["jobs"] += 1
            b["breach" if live[j.id]["state"] == "breach" else "within"] += 1
            s = live[j.id]["segments"]["total"]["seconds"]
            if s is not None:
                b["mins"].append(s / 60)
        rows = [[p, b["jobs"], b["within"], b["breach"], round(100 * b["within"] / b["jobs"], 1) if b["jobs"] else "",
                 round(sum(b["mins"]) / len(b["mins"]), 1) if b["mins"] else ""] for p, b in sorted(by_p.items())]
        tot = sum(b["jobs"] for b in by_p.values())
        within = sum(b["within"] for b in by_p.values())
        return {"kind": kind, "columns": ["Priority", "Jobs", "Within SLA", "Breached", "Compliance %", "Avg total min"], "rows": rows,
                "summary": {"jobs": tot, "compliance_pct": round(100 * within / tot, 1) if tot else None}}

    if kind == "performance":
        team = performance.team_summary(db, actor, "30d")
        rows = [[r["rank"], r["full_name"], r["score"], r["jobs_scored"], r["completed"]] for r in team["ranking"]]
        return {"kind": kind, "columns": ["Rank", "Technician", "Score", "Jobs scored", "Completed"], "rows": rows,
                "summary": {"team_score": team["team_score"], "note": team["ranking_note"], "period": "last 30 days"}}

    if kind == "incidents":
        by_dev = Counter(devices[j.device_id].code for j in jobs)
        cats = {c.id: c.name for c in db.scalars(select(IncidentCategory).where(IncidentCategory.company_id == cid))}
        by_cat = Counter(cats.get(j.category_id, "Uncategorized") for j in jobs)
        rows = [["Device", k, v] for k, v in by_dev.most_common(20)] + [["Category", k, v] for k, v in by_cat.most_common()]
        return {"kind": kind, "columns": ["Dimension", "Value", "Incidents"], "rows": rows, "summary": {"incidents": len(jobs)}}

    raise HTTPException(404, "Unknown report type")


def _safe(cell):
    s = "" if cell is None else str(cell)
    # neutralize spreadsheet formula injection in text cells (numbers are left alone)
    return "'" + s if isinstance(cell, str) and s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def to_csv(report: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(report["columns"])
    for row in report["rows"]:
        w.writerow([_safe(c) for c in row])
    return buf.getvalue()
