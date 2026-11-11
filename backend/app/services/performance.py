"""Performance scoring. Weights and adjustment parameters live in a versioned, tenant-editable ScoringVersion.
Scores are explained line by line and can be appealed. Raw completion speed alone never ranks anyone."""
import json
from collections import defaultdict
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..models import (
    Job, JobEvent, JobEvidence, JobAssignment, LocationPing, PerformanceScore, ScoringVersion, SlaPolicy, User,
    Appeal, WorkReport, AtmDevice,
)
from ..security import require
from ..timeutil import now, aware, iso
from . import sla, gps
from .core import audit, get_owned, notify

DIMENSIONS = ("response_time", "mobilization", "sla_achievement", "documentation", "resolution_quality")
# Initial *proposal* from the product spec. Tenants can publish new versions; none of this is contractual.
DEFAULT_WEIGHTS = {"response_time": 15, "mobilization": 15, "sla_achievement": 30, "documentation": 15, "resolution_quality": 25}
DEFAULT_PARAMS = {
    "overlap_allowance_pct": 20,          # extra time when the technician held overlapping assignments
    "assumed_speed_kmh": 25,              # converts distance to expected travel time
    "road_factor": 1.4,                   # roads are longer than the straight line between two points
    "complexity_min_per_checklist_item": 2,
    "excusable_hold_reasons": ["spare_part_unavailable", "site_access_delay", "connectivity_issue", "awaiting_bank_confirmation"],
    "correction_penalty": 25,
}


# ------------------------------------------------------------------ versions
def active_version(db: Session, company_id: str) -> ScoringVersion:
    v = db.scalar(select(ScoringVersion).where(ScoringVersion.company_id == company_id).order_by(ScoringVersion.version.desc()).limit(1))
    if not v:
        v = ScoringVersion(company_id=company_id, version=1, note="Initial proposal (configurable)",
                           weights_json=json.dumps({"weights": DEFAULT_WEIGHTS, "params": DEFAULT_PARAMS}))
        db.add(v)
        db.flush()
    return v


def version_out(v: ScoringVersion) -> dict:
    cfg = json.loads(v.weights_json)
    return {"version": v.version, "weights": cfg["weights"], "params": cfg["params"], "note": v.note,
            "effective_from": iso(v.effective_from), "created_by": v.created_by}


def list_versions(db: Session, actor: User) -> list[dict]:
    require(actor, "scoring:manage")
    active_version(db, actor.company_id)
    return [version_out(v) for v in db.scalars(select(ScoringVersion).where(ScoringVersion.company_id == actor.company_id).order_by(ScoringVersion.version.desc()))]


def create_version(db: Session, actor: User, weights: dict, params: dict | None, note: str | None) -> dict:
    require(actor, "scoring:manage")
    if set(weights) != set(DIMENSIONS) or any(w < 0 for w in weights.values()):
        raise HTTPException(422, f"weights must contain exactly: {', '.join(DIMENSIONS)} (non-negative)")
    if abs(sum(weights.values()) - 100) > 0.01:
        raise HTTPException(422, "weights must add up to 100")
    prev = active_version(db, actor.company_id)
    merged = {**json.loads(prev.weights_json)["params"], **(params or {})}
    v = ScoringVersion(company_id=actor.company_id, version=prev.version + 1, note=note, created_by=actor.id,
                       weights_json=json.dumps({"weights": weights, "params": merged}))
    db.add(v)
    audit(db, actor, "scoring.version_published", "scoring_version", None, version_out(prev), {"weights": weights, "params": merged})
    db.flush()
    return version_out(v)


# ------------------------------------------------------------------ scoring one job
def _ratio(actual_s, target_min):
    if actual_s is None or not target_min:
        return None
    target_s = target_min * 60
    return 100.0 if actual_s <= target_s else max(0.0, 100.0 * target_s / actual_s)


def _excusable_hold_seconds(events: list[JobEvent], reasons: list[str]) -> int:
    total, started = 0, None
    for e in events:
        if e.to_status == "ON_HOLD":
            code = (e.note or "").split(":")[0].strip()
            started = aware(e.occurred_at) if code in reasons else None
        elif e.from_status == "ON_HOLD" and started:
            total += max(0, int((aware(e.occurred_at) - started).total_seconds()))
            started = None
    return total


def score_job(db: Session, job: Job) -> PerformanceScore | None:
    if not job.assigned_to or db.scalar(select(PerformanceScore).where(PerformanceScore.job_id == job.id)):
        return None
    ver = active_version(db, job.company_id)
    cfg = json.loads(ver.weights_json)
    weights, params = cfg["weights"], cfg["params"]
    policy = db.get(SlaPolicy, job.sla_policy_id) if job.sla_policy_id else None
    live = sla.compute(db, job, persist=False)
    seg = live["segments"]
    events = list(db.scalars(select(JobEvent).where(JobEvent.job_id == job.id).order_by(JobEvent.occurred_at)))
    report = db.scalar(select(WorkReport).where(WorkReport.job_id == job.id).order_by(WorkReport.version.desc()).limit(1))
    checklist = json.loads(report.checklist_json or "[]") if report else []
    adjustments: list[dict] = []

    excused = _excusable_hold_seconds(events, params["excusable_hold_reasons"])
    if excused:
        adjustments.append({"factor": "excusable_hold", "text": f"{round(excused / 60)} min on hold for spare parts, site access, connectivity or bank confirmation was not counted against repair/total time."})

    # overlapping assignments => allowance
    my_start = db.scalar(select(func.min(JobAssignment.assigned_at)).where(JobAssignment.job_id == job.id, JobAssignment.technician_id == job.assigned_to))
    overlap = 0
    if my_start:
        for other in db.scalars(select(Job).where(Job.company_id == job.company_id, Job.assigned_to == job.assigned_to, Job.id != job.id)):
            oa = db.scalar(select(func.min(JobAssignment.assigned_at)).where(JobAssignment.job_id == other.id, JobAssignment.technician_id == job.assigned_to))
            if oa and aware(oa) < aware(job.closed_at or now()) and (other.closed_at is None or aware(other.closed_at) > aware(my_start)):
                overlap += 1
    allow = 1 + (params["overlap_allowance_pct"] / 100 if overlap else 0)
    if overlap:
        adjustments.append({"factor": "overlapping_workload", "text": f"{overlap} overlapping assignment(s): time targets extended by {params['overlap_allowance_pct']}%."})

    # travel distance => extra total allowance (needs GPS data; otherwise no adjustment)
    extra_total_min = 0.0
    dev = db.get(AtmDevice, job.device_id)
    t_enroute = next((aware(e.occurred_at) for e in events if e.to_status == "EN_ROUTE"), None)
    if t_enroute and dev and dev.lat is not None and policy:
        ping = db.scalar(select(LocationPing).where(LocationPing.user_id == job.assigned_to, LocationPing.recorded_at >= t_enroute)
                         .order_by(LocationPing.recorded_at).limit(1))
        if ping:
            km = gps.haversine_km(ping.lat, ping.lon, dev.lat, dev.lon)
            # older scoring versions have no road_factor: same default as dispatch
            expected = km * params.get("road_factor", 1.4) / params["assumed_speed_kmh"] * 60
            extra_total_min = max(0.0, expected - policy.travel_min)
            if extra_total_min:
                adjustments.append({"factor": "travel_distance", "text": f"Started {km:.1f} km from the site; total target extended by {extra_total_min:.0f} min (assumed {params['assumed_speed_kmh']} km/h)."})
    n_items = len(checklist)
    complexity_min = n_items * params["complexity_min_per_checklist_item"]
    if complexity_min:
        adjustments.append({"factor": "complexity", "text": f"{n_items} checklist items: repair target extended by {complexity_min} min."})
    if not adjustments:
        adjustments.append({"factor": "none", "text": "No adjustment factors applied."})

    def secs(name):
        return seg[name]["seconds"]

    repair_s = (secs("repair") or 0) - excused if secs("repair") is not None else None
    total_s = (secs("total") or 0) - excused if secs("total") is not None else None
    dims: dict[str, float | None] = {
        "response_time": _ratio(secs("response"), (policy.response_min * allow) if policy else None),
        "mobilization": _ratio(secs("mobilization"), (policy.mobilization_min * allow) if policy else None),
        "sla_achievement": _ratio(total_s, ((policy.total_min + extra_total_min) * allow) if policy else None),
    }
    if repair_s is not None and policy and dims["sla_achievement"] is not None:
        rep = _ratio(repair_s, (policy.repair_min + complexity_min) * allow)
        dims["sla_achievement"] = round((dims["sla_achievement"] + rep) / 2, 1)
    before = db.scalar(select(func.count()).select_from(JobEvidence).where(JobEvidence.job_id == job.id, JobEvidence.kind == "before")) or 0
    after = db.scalar(select(func.count()).select_from(JobEvidence).where(JobEvidence.job_id == job.id, JobEvidence.kind == "after")) or 0
    done = sum(1 for c in checklist if c.get("done"))
    dims["documentation"] = (25 if report and len((report.notes or "")) >= 20 else 0) + (25 * done / n_items if n_items else 25) \
        + (25 if before else 0) + (25 if after else 0)
    dims["resolution_quality"] = max(0.0, 100.0 - params["correction_penalty"] * (job.correction_count or 0))

    scored = {k: v for k, v in dims.items() if v is not None}
    wsum = sum(weights[k] for k in scored)
    total = round(sum(weights[k] * v for k, v in scored.items()) / wsum, 1) if wsum else 0.0
    lines = [f"{k.replace('_', ' ').title()}: {round(v)} / 100 (weight {weights[k]}%)" for k, v in scored.items()]
    lines += [f"{k.replace('_', ' ').title()}: not scored (no SLA policy target)" for k, v in dims.items() if v is None]
    row = PerformanceScore(company_id=job.company_id, technician_id=job.assigned_to, job_id=job.id,
                           scoring_version=ver.version, dimensions_json=json.dumps({k: (round(v, 1) if v is not None else None) for k, v in dims.items()}),
                           adjustments_json=json.dumps(adjustments), total=total, explanation="\n".join(lines))
    db.add(row)
    db.flush()
    return row


# ------------------------------------------------------------------ read models
def _effective(s: PerformanceScore) -> float:
    return s.override_total if s.override_total is not None else s.total


def score_out(db: Session, s: PerformanceScore) -> dict:
    job = db.get(Job, s.job_id)
    appeal = db.scalar(select(Appeal).where(Appeal.score_id == s.id).order_by(Appeal.created_at.desc()).limit(1))
    return {"id": s.id, "job_id": s.job_id, "job_code": job.code if job else None, "technician_id": s.technician_id,
            "scoring_version": s.scoring_version, "dimensions": json.loads(s.dimensions_json),
            "adjustments": json.loads(s.adjustments_json), "total": s.total, "override_total": s.override_total,
            "override_note": s.override_note, "effective_total": _effective(s), "explanation": s.explanation,
            "created_at": iso(s.created_at),
            "appeal": {"id": appeal.id, "status": appeal.status, "reason": appeal.reason, "decision_note": appeal.decision_note} if appeal else None}


def _period_start(period: str):
    days = {"7d": 7, "30d": 30, "90d": 90, "today": 1}.get(period, 30)
    return now() - timedelta(days=days)


def technician_summary(db: Session, company_id: str, tech_id: str, since) -> dict:
    scores = list(db.scalars(select(PerformanceScore).where(PerformanceScore.company_id == company_id,
                                                            PerformanceScore.technician_id == tech_id,
                                                            PerformanceScore.created_at >= since)))
    dims = defaultdict(list)
    for s in scores:
        for k, v in json.loads(s.dimensions_json).items():
            if v is not None:
                dims[k].append(v)
    return {"jobs_scored": len(scores),
            "score": round(sum(_effective(s) for s in scores) / len(scores), 1) if scores else None,
            "dimensions": {k: round(sum(v) / len(v), 1) for k, v in dims.items()}}


def team_summary(db: Session, actor: User, period: str = "30d") -> dict:
    require(actor, "performance:read_team")
    since = _period_start(period)
    techs = list(db.scalars(select(User).where(User.company_id == actor.company_id, User.role == "technician", User.is_active.is_(True))))
    rows = []
    for t in techs:
        s = technician_summary(db, actor.company_id, t.id, since)
        completed = db.scalar(select(func.count()).select_from(Job).where(Job.company_id == actor.company_id, Job.assigned_to == t.id,
                                                                           Job.status == "CLOSED", Job.closed_at >= since)) or 0
        rows.append({"technician_id": t.id, "full_name": t.full_name, "completed": completed, **s})
    ranked = sorted([r for r in rows if r["score"] is not None], key=lambda r: -r["score"])
    for i, r in enumerate(ranked, 1):
        r["rank"] = i
    scored = [r["score"] for r in ranked]
    closed = list(db.scalars(select(Job).where(Job.company_id == actor.company_id, Job.status == "CLOSED", Job.closed_at >= since)))
    live = sla.compute_many(db, closed)
    within = [j for j in closed if live[j.id]["state"] != "breach"]
    trend = defaultdict(lambda: [0, 0])
    for j in closed:
        day = aware(j.closed_at).date().isoformat()
        trend[day][0] += 1
        trend[day][1] += 1 if live[j.id]["state"] != "breach" else 0
    return {
        "period": period,
        "team_score": round(sum(scored) / len(scored), 1) if scored else None,
        "sla_achievement_pct": round(100 * len(within) / len(closed), 1) if closed else None,
        "jobs_completed": len(closed),
        "ranking": ranked,
        "unranked": [r for r in rows if r["score"] is None],
        "sla_trend": [{"day": d, "pct": round(100 * w / n, 1)} for d, (n, w) in sorted(trend.items())],
        "ranking_note": "Ranked by weighted score with adjustments for complexity, distance, workload and excusable delays. Not by raw completion time.",
    }


def technician_detail(db: Session, actor: User, tech_id: str, period: str = "30d") -> dict:
    if actor.role == "technician":
        if actor.id != tech_id:
            raise HTTPException(403, "You can only view your own performance")
    else:
        require(actor, "performance:read_team")
    tech = get_owned(db, User, tech_id, actor.company_id)
    since = _period_start(period)
    scores = list(db.scalars(select(PerformanceScore).where(PerformanceScore.company_id == actor.company_id, PerformanceScore.technician_id == tech_id,
                                                            PerformanceScore.created_at >= since).order_by(PerformanceScore.created_at.desc())))
    return {"technician": {"id": tech.id, "full_name": tech.full_name}, "summary": technician_summary(db, actor.company_id, tech_id, since),
            "scores": [score_out(db, s) for s in scores]}


# ------------------------------------------------------------------ appeals
def create_appeal(db: Session, actor: User, score_id: str, reason: str) -> Appeal:
    s = get_owned(db, PerformanceScore, score_id, actor.company_id)
    if s.technician_id != actor.id:
        raise HTTPException(403, "You can only appeal your own scores")
    if len(reason.strip()) < 10:
        raise HTTPException(422, "Please explain the appeal (min 10 characters)")
    if db.scalar(select(Appeal).where(Appeal.score_id == s.id, Appeal.status == "open")):
        raise HTTPException(409, "An appeal is already open for this score")
    a = Appeal(company_id=actor.company_id, score_id=s.id, technician_id=actor.id, reason=reason.strip())
    db.add(a)
    audit(db, actor, "performance.appeal_created", "score", s.id, None, {"reason": reason})
    sup = list(db.scalars(select(User.id).where(User.company_id == actor.company_id, User.role.in_(["supervisor", "management"]), User.is_active.is_(True))))
    notify(db, actor.company_id, sup, "appeal", f"Score appeal from {actor.full_name}", reason[:140], "medium", s.job_id)
    db.flush()
    return a


def list_appeals(db: Session, actor: User, status: str | None = None) -> list[dict]:
    stmt = select(Appeal).where(Appeal.company_id == actor.company_id)
    if actor.role == "technician":
        stmt = stmt.where(Appeal.technician_id == actor.id)
    else:
        require(actor, "performance:read_team")
    if status:
        stmt = stmt.where(Appeal.status == status)
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == actor.company_id))}
    return [{"id": a.id, "score_id": a.score_id, "technician": names.get(a.technician_id), "reason": a.reason, "status": a.status,
             "decision_note": a.decision_note, "created_at": iso(a.created_at), "decided_at": iso(a.decided_at),
             "score": score_out(db, db.get(PerformanceScore, a.score_id))}
            for a in db.scalars(stmt.order_by(Appeal.created_at.desc()))]


def decide_appeal(db: Session, actor: User, appeal_id: str, accept: bool, note: str, new_total: float | None) -> Appeal:
    require(actor, "performance:decide")
    a = get_owned(db, Appeal, appeal_id, actor.company_id)
    if a.status != "open":
        raise HTTPException(409, "Appeal already decided")
    if len(note.strip()) < 3:
        raise HTTPException(422, "A decision note is required")
    s = db.get(PerformanceScore, a.score_id)
    before = {"effective_total": _effective(s)}
    if accept:
        if new_total is None or not (0 <= new_total <= 100):
            raise HTTPException(422, "new_total (0-100) is required when accepting")
        s.override_total, s.override_note = new_total, note.strip()
    a.status = "accepted" if accept else "rejected"
    a.decided_by, a.decision_note, a.decided_at = actor.id, note.strip(), now()
    audit(db, actor, "performance.appeal_decided", "appeal", a.id, before, {"status": a.status, "new_total": new_total, "note": note})
    notify(db, actor.company_id, [a.technician_id], "appeal_decision", f"Your appeal was {a.status}", note[:140], "medium", s.job_id)
    return a
