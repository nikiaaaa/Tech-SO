"""Cross-cutting helpers: tenant-safe lookup, audit, post-commit realtime events, settings, notifications."""
import json
from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from ..models import AuditLog, CompanySetting, Notification, User
from ..realtime import hub

_SENSITIVE = ("password", "token", "secret", "hash")


def get_owned(db: Session, model, obj_id: str, company_id: str):
    """Tenant isolation primitive: a row from another company is indistinguishable from a missing row."""
    obj = db.scalar(select(model).where(model.id == obj_id, model.company_id == company_id))
    if obj is None:
        raise HTTPException(404, f"{model.__name__} not found")
    return obj


def _clean(data):
    if isinstance(data, dict):
        return {k: ("[redacted]" if any(s in k.lower() for s in _SENSITIVE) else _clean(v)) for k, v in data.items()}
    if isinstance(data, list):
        return [_clean(v) for v in data]
    return data


def audit(db: Session, actor: User | None, action: str, entity: str | None = None, entity_id: str | None = None,
          before=None, after=None, company_id: str | None = None) -> None:
    cid = company_id or (actor.company_id if actor else None)
    db.add(AuditLog(
        company_id=cid, actor_id=actor.id if actor else None, action=action, entity=entity, entity_id=entity_id,
        before_json=json.dumps(_clean(before), default=str) if before is not None else None,
        after_json=json.dumps(_clean(after), default=str) if after is not None else None,
    ))


# ---- realtime events are queued on the session and only sent after a successful commit ----
def emit(db: Session, company_id: str, payload: dict, roles: set[str] | None = None,
         user_ids: set[str] | None = None) -> None:
    db.info.setdefault("pending_events", []).append((company_id, payload, roles, user_ids))


@event.listens_for(Session, "after_commit")
def _flush_events(session: Session) -> None:
    for args in session.info.pop("pending_events", []):
        hub.publish(*args)


@event.listens_for(Session, "after_rollback")
def _drop_events(session: Session) -> None:
    session.info.pop("pending_events", None)


# ---- per-tenant settings ----
DEFAULT_SETTINGS = {
    "gps_policy": {"enabled": True, "min_interval_s": 10, "max_accuracy_m": 200,
                   "stale_after_s": 300, "retention_days": 30},
    "notification_rules": {"accept_timeout_min": 10, "repeat_interval_min": 5,
                           "escalate_to_roles": ["supervisor"], "high_priority_sound": True},
    "general": {"timezone": "Asia/Jakarta", "language": "id", "display_name": ""},
}


def get_setting(db: Session, company_id: str, key: str) -> dict:
    row = db.scalar(select(CompanySetting).where(CompanySetting.company_id == company_id, CompanySetting.key == key))
    value = dict(DEFAULT_SETTINGS.get(key, {}))
    if row:
        value.update(json.loads(row.value_json))
    return value


def put_setting(db: Session, company_id: str, key: str, value: dict) -> None:
    row = db.scalar(select(CompanySetting).where(CompanySetting.company_id == company_id, CompanySetting.key == key))
    if row:
        row.value_json = json.dumps(value)
    else:
        db.add(CompanySetting(company_id=company_id, key=key, value_json=json.dumps(value)))


# ---- notifications (in-app + WebSocket; mobile push is not implemented) ----
def notify(db: Session, company_id: str, user_ids: list[str], kind: str, title: str, body: str = "",
           priority: str = "medium", job_id: str | None = None) -> None:
    for uid_ in set(user_ids):
        db.add(Notification(company_id=company_id, user_id=uid_, kind=kind, title=title, body=body,
                            priority=priority, job_id=job_id))
    emit(db, company_id, {"type": "notification", "kind": kind, "title": title, "priority": priority,
                          "job_id": job_id}, user_ids=set(user_ids))
