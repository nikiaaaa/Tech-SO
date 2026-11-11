"""Offline sync. The device replays queued actions in order; each is idempotent by client_id and is validated by the
same state machine as a live request. The response tells the UI which actions are server-confirmed and which were refused."""
import json
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SyncReceipt, User
from . import jobs, gps

MAX_ACTIONS = 200


def _run(db: Session, actor: User, a: dict):
    t, jid, occ, p = a["type"], a.get("job_id"), a.get("occurred_at"), a.get("payload") or {}
    if t == "ping":
        return gps.record_ping(db, actor, float(p["lat"]), float(p["lon"]), p.get("accuracy_m"),
                               datetime.fromisoformat(occ.replace("Z", "+00:00")) if occ else None, p.get("job_id"))
    when = datetime.fromisoformat(occ.replace("Z", "+00:00")) if occ else None
    table = {
        "accept": lambda: jobs.accept(db, actor, jid, when),
        "reject": lambda: jobs.reject(db, actor, jid, p.get("reason"), when),
        "start_journey": lambda: jobs.start_journey(db, actor, jid, when),
        "arrive": lambda: jobs.arrive(db, actor, jid, when),
        "start_work": lambda: jobs.start_work(db, actor, jid, when),
        "hold": lambda: jobs.hold(db, actor, jid, p.get("reason_code"), p.get("note"), when),
        "resume": lambda: jobs.resume(db, actor, jid, when),
        "resolve": lambda: jobs.resolve(db, actor, jid, p.get("resolution"), p.get("notes"), p.get("checklist"), p.get("parts_used"), when),
    }
    if t not in table:
        raise HTTPException(422, f"Unknown action type '{t}'")
    table[t]()
    return {}


def process(db: Session, actor: User, actions: list[dict]) -> list[dict]:
    if len(actions) > MAX_ACTIONS:
        raise HTTPException(413, f"At most {MAX_ACTIONS} actions per sync")
    results = []
    for a in actions:
        cid = str(a.get("client_id", ""))[:80]
        if not cid:
            results.append({"client_id": None, "status": "rejected", "error": "client_id missing"})
            continue
        prior = db.scalar(select(SyncReceipt).where(SyncReceipt.user_id == actor.id, SyncReceipt.client_id == cid))
        if prior:
            results.append({**json.loads(prior.result_json), "replayed": True})
            continue
        try:
            detail = _run(db, actor, a)
            db.commit()
            res = {"client_id": cid, "status": "confirmed", **detail}
        except HTTPException as e:
            db.rollback()
            if e.status_code >= 500:
                raise
            res = {"client_id": cid, "status": "rejected", "error": e.detail, "code": e.status_code}
        except (KeyError, ValueError, TypeError) as e:
            db.rollback()
            res = {"client_id": cid, "status": "rejected", "error": f"Malformed action: {type(e).__name__}", "code": 422}
        db.add(SyncReceipt(company_id=actor.company_id, user_id=actor.id, client_id=cid, result_json=json.dumps(res)))
        db.commit()
        results.append(res)
    return results
