"""SLA engine. Targets come only from tenant-configured SlaPolicy rows; nothing is hard-coded.

Known limit: durations are wall-clock. Operating hours / holidays are not applied yet.
ON_HOLD never pauses the clock; only an approved SlaPause does.
"""
import json
from collections import defaultdict
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Job, JobEvent, SlaPolicy, SlaPause, SlaTracking, AtmDevice, IncidentCategory
from ..timeutil import now, aware

TERMINAL = {"CLOSED", "CANCELLED"}
SEGMENTS = ("response", "dispatch", "mobilization", "travel", "repair", "verification", "total")


def pick_policy(db: Session, company_id: str, priority: str, bank_id, category_id, device_type) -> SlaPolicy | None:
    best, best_score = None, -1
    for p in db.scalars(select(SlaPolicy).where(
            SlaPolicy.company_id == company_id, SlaPolicy.active.is_(True), SlaPolicy.priority == priority)):
        score = 0
        for have, want, weight in ((p.bank_id, bank_id, 4), (p.category_id, category_id, 2), (p.device_type, device_type, 1)):
            if have is None:
                continue
            if have != want:
                score = -1
                break
            score += weight
        if score > best_score:
            best, best_score = p, score
    return best


def _paused_seconds(pauses: list[SlaPause]) -> int:
    total = 0
    for p in pauses:
        if p.started_at:
            end = aware(p.ended_at) or now()
            total += max(0, int((end - aware(p.started_at)).total_seconds()))
    return total


def _timestamps(events: list[JobEvent], created) -> dict:
    ts: dict = {"CREATED": created}
    for e in events:
        st, t = e.to_status, aware(e.occurred_at)
        if not st:
            continue
        if st == "ASSIGNED":
            ts.setdefault("ASSIGNED", t)
            # a (re)assignment restarts the technician-side clock
            for k in ("ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "RESOLVED", "VERIFICATION", "CLOSED"):
                ts.pop(k, None)
        elif st == "IN_PROGRESS":
            ts.setdefault("IN_PROGRESS", t)
            if e.event_type == "correction_requested":
                # the report was sent back: the job is not resolved any more, so the clock runs again
                for k in ("RESOLVED", "VERIFICATION", "CLOSED"):
                    ts.pop(k, None)
        elif st == "VERIFICATION":
            ts["VERIFICATION"] = t
            ts.pop("CLOSED", None)
        else:
            ts[st] = t
    return ts


def _state(elapsed_s: float, target_min: int, warning_pct: int) -> str:
    if not target_min:
        return "no_target"
    ratio = elapsed_s / (target_min * 60)
    return "breach" if ratio >= 1 else "warning" if ratio * 100 >= warning_pct else "on_track"


def _compute(job: Job, policy: SlaPolicy | None, events: list[JobEvent], pauses: list[SlaPause]) -> dict:
    created = aware(job.created_at)
    ts = _timestamps(events, created)
    n = now()
    paused = _paused_seconds(pauses)
    terminal = job.status in TERMINAL

    def span(a, b):
        start, end = ts.get(a), ts.get(b)
        if start is None:
            return None, False
        if end is not None:
            return max(0, (end - start).total_seconds()), True
        return (None, False) if terminal else (max(0, (n - start).total_seconds()), False)

    raw = {
        "dispatch": span("CREATED", "ASSIGNED"),
        "response": span("NOTIFIED", "ACCEPTED"),
        "mobilization": span("ACCEPTED", "EN_ROUTE"),
        "travel": span("EN_ROUTE", "ARRIVED"),
        "repair": span("IN_PROGRESS", "RESOLVED"),
        "verification": span("VERIFICATION", "CLOSED"),
    }
    total_s, total_done = span("CREATED", "RESOLVED")
    if total_s is not None:
        total_s = max(0, total_s - paused)
    raw["total"] = (total_s, total_done)

    segments = {}
    for name in SEGMENTS:
        secs, done = raw[name]
        target = getattr(policy, f"{name}_min", None) if policy else None
        segments[name] = {
            "seconds": int(secs) if secs is not None else None,
            "done": done,
            "target_min": target,
            "state": _state(secs, target, policy.warning_pct) if (policy and secs is not None) else ("no_policy" if not policy else "pending"),
        }

    if job.status == "CANCELLED":
        state = "cancelled"
    elif not policy:
        state = "no_policy"
    else:
        state = segments["total"]["state"] if segments["total"]["seconds"] is not None else "on_track"

    due_at = None
    remaining = None
    if policy:
        due_at = created + timedelta(minutes=policy.total_min, seconds=paused)
        remaining = int((due_at - (ts.get("RESOLVED") or n)).total_seconds())

    return {"state": state, "segments": segments, "paused_seconds": paused,
            "due_at": due_at.isoformat() if due_at else None, "remaining_seconds": remaining,
            # True once the technician resolved the job: `remaining_seconds` is then the final margin, not a countdown
            "stopped": "RESOLVED" in ts or terminal,
            "policy_id": policy.id if policy else None}


def compute_many(db: Session, jobs: list[Job]) -> dict[str, dict]:
    """Live SLA for many jobs with three queries per 500 jobs instead of three per job."""
    events: dict[str, list] = defaultdict(list)
    pauses: dict[str, list] = defaultdict(list)
    ids = [j.id for j in jobs]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for e in db.scalars(select(JobEvent).where(JobEvent.job_id.in_(chunk)).order_by(JobEvent.occurred_at, JobEvent.created_at)):
            events[e.job_id].append(e)
        for p in db.scalars(select(SlaPause).where(SlaPause.job_id.in_(chunk), SlaPause.status.in_(["approved", "ended"]))):
            pauses[p.job_id].append(p)
    policy_ids = {j.sla_policy_id for j in jobs if j.sla_policy_id}
    policies = {p.id: p for p in db.scalars(select(SlaPolicy).where(SlaPolicy.id.in_(policy_ids)))} if policy_ids else {}
    return {j.id: _compute(j, policies.get(j.sla_policy_id), events[j.id], pauses[j.id]) for j in jobs}


def compute(db: Session, job: Job, persist: bool = True) -> dict:
    result = compute_many(db, [job])[job.id]
    if persist:
        row = db.scalar(select(SlaTracking).where(SlaTracking.job_id == job.id))
        if not row:
            row = SlaTracking(company_id=job.company_id, job_id=job.id)
            db.add(row)
        row.segments_json = json.dumps(result["segments"])
        row.paused_seconds = result["paused_seconds"]
        row.state = result["state"]
    return result


def preview(db: Session, company_id: str, device_id: str, category_id, priority: str) -> dict:
    device = db.get(AtmDevice, device_id)
    cat = db.get(IncidentCategory, category_id) if category_id else None
    policy = pick_policy(db, company_id, priority, device.bank_id if device else None, cat.id if cat else None,
                         device.device_type if device else None)
    if not policy:
        return {"policy": None, "message": "No SLA policy configured for this combination"}
    return {"policy": {"id": policy.id, "name": policy.name, "total_min": policy.total_min,
                       "response_min": policy.response_min},
            "due_at": (now() + timedelta(minutes=policy.total_min)).isoformat()}
