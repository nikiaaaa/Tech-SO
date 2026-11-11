"""Configuration and organization: reference data, SLA policies, teams, users, settings, audit logs."""
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Bank, Branch, IncidentCategory, SlaPolicy, Team, TeamMember, User, AuditLog, ROLES
from ..schemas import (BankIn, BranchIn, CategoryIn, GeneralIn, GpsPolicyIn, MemberIn, NotificationRulesIn, SlaPolicyIn,
                       TeamIn, UserCreate, UserPatch)
from ..security import current_user, hash_password, require, validate_password_strength
from ..services.core import audit, get_owned, get_setting, put_setting
from ..timeutil import iso

router = APIRouter(tags=["configuration"])


# ------------------------------------------------------------ reference data
@router.get("/banks")
def banks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:read")
    return [{"id": b.id, "name": b.name, "code": b.code} for b in db.scalars(select(Bank).where(Bank.company_id == user.company_id).order_by(Bank.name))]


@router.post("/banks", status_code=201)
def create_bank(body: BankIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "settings:manage")
    if db.scalar(select(Bank).where(Bank.company_id == user.company_id, Bank.code == body.code)):
        raise HTTPException(409, "Bank code already exists")
    b = Bank(company_id=user.company_id, name=body.name, code=body.code)
    db.add(b)
    db.flush()
    audit(db, user, "bank.created", "bank", b.id, None, body.model_dump())
    db.commit()
    return {"id": b.id, "name": b.name, "code": b.code}


@router.get("/branches")
def branches(bank_id: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "devices:read")
    stmt = select(Branch).where(Branch.company_id == user.company_id)
    if bank_id:
        stmt = stmt.where(Branch.bank_id == bank_id)
    return [{"id": b.id, "bank_id": b.bank_id, "name": b.name, "city": b.city, "address": b.address} for b in db.scalars(stmt.order_by(Branch.name))]


@router.post("/branches", status_code=201)
def create_branch(body: BranchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "settings:manage")
    get_owned(db, Bank, body.bank_id, user.company_id)
    b = Branch(company_id=user.company_id, **body.model_dump())
    db.add(b)
    db.flush()
    audit(db, user, "branch.created", "branch", b.id, None, body.model_dump())
    db.commit()
    return {"id": b.id, "name": b.name}


def _cat(c: IncidentCategory) -> dict:
    return {"id": c.id, "name": c.name, "device_type": c.device_type, "default_priority": c.default_priority,
            "checklist": json.loads(c.checklist_json or "[]")}


@router.get("/incident-categories")
def categories(user: User = Depends(current_user), db: Session = Depends(get_db)):
    # technicians need these to render checklists on their own jobs
    return [_cat(c) for c in db.scalars(select(IncidentCategory).where(IncidentCategory.company_id == user.company_id).order_by(IncidentCategory.name))]


@router.post("/incident-categories", status_code=201)
def create_category(body: CategoryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "settings:manage")
    c = IncidentCategory(company_id=user.company_id, name=body.name, device_type=body.device_type,
                         default_priority=body.default_priority, checklist_json=json.dumps(body.checklist))
    db.add(c)
    db.flush()
    audit(db, user, "category.created", "category", c.id, None, body.model_dump())
    db.commit()
    return _cat(c)


@router.put("/incident-categories/{cid}")
def update_category(cid: str, body: CategoryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "settings:manage")
    c = get_owned(db, IncidentCategory, cid, user.company_id)
    before = _cat(c)
    c.name, c.device_type, c.default_priority, c.checklist_json = body.name, body.device_type, body.default_priority, json.dumps(body.checklist)
    audit(db, user, "category.updated", "category", c.id, before, body.model_dump())
    db.commit()
    return _cat(c)


@router.get("/checklists/{category_id}")
def checklist(category_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = get_owned(db, IncidentCategory, category_id, user.company_id)
    return [{"label": x, "done": False} for x in json.loads(c.checklist_json or "[]")]


# ------------------------------------------------------------ SLA policies
def _policy(p: SlaPolicy) -> dict:
    return {k: getattr(p, k) for k in ("id", "name", "bank_id", "device_type", "category_id", "priority", "response_min", "dispatch_min",
                                        "mobilization_min", "travel_min", "repair_min", "verification_min", "total_min", "warning_pct", "active")}


@router.get("/sla-policies")
def sla_policies(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "sla:read")
    return [_policy(p) for p in db.scalars(select(SlaPolicy).where(SlaPolicy.company_id == user.company_id).order_by(SlaPolicy.priority, SlaPolicy.name))]


def _validate_policy_refs(db, user, body: SlaPolicyIn) -> None:
    if body.bank_id:
        get_owned(db, Bank, body.bank_id, user.company_id)
    if body.category_id:
        get_owned(db, IncidentCategory, body.category_id, user.company_id)


@router.post("/sla-policies", status_code=201)
def create_policy(body: SlaPolicyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "sla:configure")
    _validate_policy_refs(db, user, body)
    p = SlaPolicy(company_id=user.company_id, **body.model_dump())
    db.add(p)
    db.flush()
    audit(db, user, "sla_policy.created", "sla_policy", p.id, None, body.model_dump())
    db.commit()
    return _policy(p)


@router.put("/sla-policies/{pid}")
def update_policy(pid: str, body: SlaPolicyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "sla:configure")
    p = get_owned(db, SlaPolicy, pid, user.company_id)
    _validate_policy_refs(db, user, body)
    before = _policy(p)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    audit(db, user, "sla_policy.updated", "sla_policy", p.id, before, body.model_dump())
    db.commit()
    return _policy(p)


# ------------------------------------------------------------ teams
def _team(db: Session, t: Team) -> dict:
    members = list(db.execute(select(User.id, User.full_name).join(TeamMember, TeamMember.user_id == User.id).where(TeamMember.team_id == t.id)))
    return {"id": t.id, "name": t.name, "supervisor_id": t.supervisor_id, "members": [{"id": m[0], "full_name": m[1]} for m in members]}


@router.get("/teams")
def teams(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "technicians:read")
    return [_team(db, t) for t in db.scalars(select(Team).where(Team.company_id == user.company_id).order_by(Team.name))]


@router.post("/teams", status_code=201)
def create_team(body: TeamIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "teams:manage")
    if body.supervisor_id:
        get_owned(db, User, body.supervisor_id, user.company_id)
    t = Team(company_id=user.company_id, name=body.name, supervisor_id=body.supervisor_id)
    db.add(t)
    db.flush()
    audit(db, user, "team.created", "team", t.id, None, body.model_dump())
    db.commit()
    return _team(db, t)


@router.post("/teams/{team_id}/members", status_code=201)
def add_member(team_id: str, body: MemberIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "teams:manage")
    t = get_owned(db, Team, team_id, user.company_id)
    u = get_owned(db, User, body.user_id, user.company_id)
    if db.scalar(select(TeamMember).where(TeamMember.team_id == t.id, TeamMember.user_id == u.id)):
        raise HTTPException(409, "Already a member")
    db.add(TeamMember(company_id=user.company_id, team_id=t.id, user_id=u.id))
    audit(db, user, "team.member_added", "team", t.id, None, {"user": u.full_name})
    db.commit()
    return _team(db, t)


@router.delete("/teams/{team_id}/members/{user_id}")
def remove_member(team_id: str, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "teams:manage")
    t = get_owned(db, Team, team_id, user.company_id)
    m = db.scalar(select(TeamMember).where(TeamMember.team_id == t.id, TeamMember.user_id == user_id, TeamMember.company_id == user.company_id))
    if not m:
        raise HTTPException(404, "Member not found")
    db.delete(m)
    audit(db, user, "team.member_removed", "team", t.id, {"user_id": user_id}, None)
    db.commit()
    return _team(db, t)


# ------------------------------------------------------------ users & roles
def _user(u: User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "phone": u.phone, "is_active": u.is_active,
            "skills": json.loads(u.skills or "[]"), "created_at": iso(u.created_at)}


@router.get("/roles")
def roles(user: User = Depends(current_user)):
    require(user, "users:read")
    return list(ROLES)


@router.get("/users")
def users(role: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "users:read")
    stmt = select(User).where(User.company_id == user.company_id)
    if role:
        stmt = stmt.where(User.role == role)
    return [_user(u) for u in db.scalars(stmt.order_by(User.full_name))]


@router.post("/users", status_code=201)
def create_user(body: UserCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "users:manage")
    validate_password_strength(body.password)
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Email already in use")
    u = User(company_id=user.company_id, email=email, full_name=body.full_name, role=body.role, phone=body.phone,
             skills=json.dumps(body.skills), password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    audit(db, user, "user.created", "user", u.id, None, {"email": email, "role": body.role})
    db.commit()
    return _user(u)


@router.patch("/users/{uid}")
def patch_user(uid: str, body: UserPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "users:manage")
    u = get_owned(db, User, uid, user.company_id)
    changes = body.model_dump(exclude_unset=True)
    if u.id == user.id and (changes.get("is_active") is False or ("role" in changes and changes["role"] != u.role)):
        raise HTTPException(409, "You cannot deactivate or change the role of your own account")
    if u.role == "super_admin" and (changes.get("is_active") is False or changes.get("role", u.role) != "super_admin"):
        others = db.scalar(select(func.count()).select_from(User).where(User.company_id == user.company_id, User.role == "super_admin",
                                                                          User.is_active.is_(True), User.id != u.id))
        if not others:
            raise HTTPException(409, "At least one active super admin is required")
    before = _user(u)
    if "password" in changes:
        validate_password_strength(changes.pop("password"))
        u.password_hash = hash_password(body.password)
        u.failed_logins, u.locked_until = 0, None
    if "skills" in changes:
        u.skills = json.dumps(changes.pop("skills"))
    for k, v in changes.items():
        setattr(u, k, v)
    audit(db, user, "user.updated", "user", u.id, before, {**_user(u), "password_changed": body.password is not None})
    db.commit()
    return _user(u)


# ------------------------------------------------------------ settings
SETTINGS = {
    "gps_policy": (GpsPolicyIn, "settings:manage"),
    "notification_rules": (NotificationRulesIn, "notifications:configure"),
    "general": (GeneralIn, "settings:manage"),
}


@router.get("/settings/{key}")
def read_setting(key: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if key not in SETTINGS:
        raise HTTPException(404, "Unknown setting")
    # technicians may read the GPS policy (the app must show exactly what is tracked and for how long)
    # and the alert rules (their app repeats the new-job alarm at the tenant's interval)
    if not (key in ("gps_policy", "notification_rules") and user.role == "technician"):
        require(user, "settings:read")
    return get_setting(db, user.company_id, key)


@router.put("/settings/{key}")
def write_setting(key: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if key not in SETTINGS:
        raise HTTPException(404, "Unknown setting")
    schema, perm = SETTINGS[key]
    require(user, perm)
    try:
        parsed = schema.model_validate(body).model_dump()
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False, include_input=False))
    before = get_setting(db, user.company_id, key)
    put_setting(db, user.company_id, key, parsed)
    audit(db, user, f"settings.{key}_updated", "setting", key, before, parsed)
    db.commit()
    return parsed


# ------------------------------------------------------------ audit logs
@router.get("/audit-logs")
def audit_logs(action: str | None = None, entity: str | None = None, actor_id: str | None = None, date_from: datetime | None = None,
               date_to: datetime | None = None, page: int = 1, page_size: int = 50,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "audit:read")
    stmt = select(AuditLog).where(AuditLog.company_id == user.company_id)
    if action:
        stmt = stmt.where(AuditLog.action.like(action.replace("%", "").replace("_", "") + "%"))
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    page_size = max(1, min(page_size, 200))
    names = {u.id: u.full_name for u in db.scalars(select(User).where(User.company_id == user.company_id))}
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).offset((max(page, 1) - 1) * page_size).limit(page_size))
    return {"total": total, "page": page, "page_size": page_size, "items": [
        {"id": a.id, "at": iso(a.created_at), "actor": names.get(a.actor_id, "system"), "action": a.action, "entity": a.entity,
         "entity_id": a.entity_id, "before": json.loads(a.before_json) if a.before_json else None,
         "after": json.loads(a.after_json) if a.after_json else None} for a in rows]}
