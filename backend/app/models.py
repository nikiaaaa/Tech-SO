"""Relational model. UUID string PKs (portable SQLite/PostgreSQL). Every operational row carries company_id."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, Index, UniqueConstraint,
)
from .db import Base


def uid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _pk():
    return Column(String(36), primary_key=True, default=uid)


def _company():
    return Column(String(36), ForeignKey("companies.id"), nullable=False, index=True)


def _ts(**kw):
    return Column(DateTime(timezone=True), **kw)


ROLES = ("super_admin", "management", "supervisor", "scheduler", "technician")
PRIORITIES = ("critical", "high", "medium", "low")
JOB_STATUSES = (
    "CREATED", "ASSIGNED", "NOTIFIED", "ACCEPTED", "REJECTED", "EN_ROUTE", "ARRIVED",
    "IN_PROGRESS", "ON_HOLD", "RESOLVED", "VERIFICATION", "CLOSED", "CANCELLED",
)


class Company(Base):
    __tablename__ = "companies"
    id = _pk()
    name = Column(String(150), nullable=False)
    is_demo = Column(Boolean, default=False)
    created_at = _ts(default=utcnow)


class Bank(Base):
    __tablename__ = "banks"
    id = _pk()
    company_id = _company()
    name = Column(String(150), nullable=False)
    code = Column(String(30), nullable=False)
    __table_args__ = (UniqueConstraint("company_id", "code"),)


class Branch(Base):
    __tablename__ = "branches"
    id = _pk()
    company_id = _company()
    bank_id = Column(String(36), ForeignKey("banks.id"), nullable=False)
    name = Column(String(150), nullable=False)
    city = Column(String(100))
    address = Column(String(255))


class User(Base):
    __tablename__ = "users"
    id = _pk()
    company_id = _company()
    email = Column(String(200), nullable=False, unique=True)
    full_name = Column(String(150), nullable=False)
    role = Column(String(30), nullable=False)
    password_hash = Column(String(300), nullable=False)
    phone = Column(String(40))
    skills = Column(Text, default="[]")  # JSON list of strings
    is_active = Column(Boolean, default=True)
    failed_logins = Column(Integer, default=0)
    locked_until = _ts(nullable=True)
    created_at = _ts(default=utcnow)


class Team(Base):
    __tablename__ = "teams"
    id = _pk()
    company_id = _company()
    name = Column(String(100), nullable=False)
    supervisor_id = Column(String(36), ForeignKey("users.id"), nullable=True)


class TeamMember(Base):
    __tablename__ = "team_members"
    id = _pk()
    company_id = _company()
    team_id = Column(String(36), ForeignKey("teams.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    __table_args__ = (UniqueConstraint("team_id", "user_id"),)


class Shift(Base):
    __tablename__ = "shifts"
    id = _pk()
    company_id = _company()
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    starts_at = _ts(nullable=False)
    ends_at = _ts(nullable=False)
    status = Column(String(20), default="planned")  # planned | active | ended
    started_at = _ts(nullable=True)
    ended_at = _ts(nullable=True)


class IncidentCategory(Base):
    __tablename__ = "incident_categories"
    id = _pk()
    company_id = _company()
    name = Column(String(120), nullable=False)
    device_type = Column(String(10), nullable=False)  # ATM | CRM | ANY
    default_priority = Column(String(10), default="medium")
    checklist_json = Column(Text, default="[]")  # JSON list of checklist item labels


class AtmDevice(Base):
    __tablename__ = "atm_devices"
    id = _pk()
    company_id = _company()
    bank_id = Column(String(36), ForeignKey("banks.id"), nullable=False)
    branch_id = Column(String(36), ForeignKey("branches.id"), nullable=True)
    code = Column(String(60), nullable=False)
    device_type = Column(String(10), nullable=False)  # ATM | CRM
    model = Column(String(100))
    address = Column(String(255))
    lat = Column(Float)
    lon = Column(Float)
    status = Column(String(20), default="online")  # online | degraded | offline | maintenance
    __table_args__ = (UniqueConstraint("company_id", "code"),)


class SlaPolicy(Base):
    """Targets in minutes. Values are configured by the tenant; none are contractual defaults."""
    __tablename__ = "sla_policies"
    id = _pk()
    company_id = _company()
    name = Column(String(150), nullable=False)
    bank_id = Column(String(36), ForeignKey("banks.id"), nullable=True)
    device_type = Column(String(10), nullable=True)
    category_id = Column(String(36), ForeignKey("incident_categories.id"), nullable=True)
    priority = Column(String(10), nullable=False)
    response_min = Column(Integer, nullable=False)
    dispatch_min = Column(Integer, nullable=False)
    mobilization_min = Column(Integer, nullable=False)
    travel_min = Column(Integer, nullable=False)
    repair_min = Column(Integer, nullable=False)
    verification_min = Column(Integer, nullable=False)
    total_min = Column(Integer, nullable=False)
    warning_pct = Column(Integer, default=80)
    active = Column(Boolean, default=True)


class Job(Base):
    __tablename__ = "jobs"
    id = _pk()
    company_id = _company()
    code = Column(String(30), nullable=False)
    device_id = Column(String(36), ForeignKey("atm_devices.id"), nullable=False, index=True)
    bank_id = Column(String(36), ForeignKey("banks.id"), nullable=True)
    category_id = Column(String(36), ForeignKey("incident_categories.id"), nullable=True)
    priority = Column(String(10), nullable=False)
    status = Column(String(20), nullable=False, default="CREATED", index=True)
    description = Column(Text, nullable=False)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    assigned_to = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    sla_policy_id = Column(String(36), ForeignKey("sla_policies.id"), nullable=True)
    created_at = _ts(default=utcnow, index=True)
    updated_at = _ts(default=utcnow, onupdate=utcnow)
    closed_at = _ts(nullable=True)
    hold_reason = Column(String(40), nullable=True)
    correction_count = Column(Integer, default=0)
    __table_args__ = (UniqueConstraint("company_id", "code"),)


class JobAssignment(Base):
    __tablename__ = "job_assignments"
    id = _pk()
    company_id = _company()
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False, index=True)
    technician_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    assigned_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    assigned_at = _ts(default=utcnow)
    status = Column(String(20), default="active")  # active | rejected | reassigned | completed
    reason = Column(Text)
    responded_at = _ts(nullable=True)


class JobEvent(Base):
    __tablename__ = "job_events"
    id = _pk()
    company_id = _company()
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False, index=True)
    event_type = Column(String(40), nullable=False)
    from_status = Column(String(20))
    to_status = Column(String(20))
    actor_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    note = Column(Text)
    # When the action really happened on the device (offline sync); created_at is server receive time.
    occurred_at = _ts(default=utcnow)
    created_at = _ts(default=utcnow)


class SlaTracking(Base):
    __tablename__ = "sla_tracking"
    id = _pk()
    company_id = _company()
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False, unique=True)
    segments_json = Column(Text, default="{}")
    paused_seconds = Column(Integer, default=0)
    state = Column(String(12), default="on_track")  # on_track | warning | breach
    updated_at = _ts(default=utcnow, onupdate=utcnow)


class SlaPause(Base):
    __tablename__ = "sla_pauses"
    id = _pk()
    company_id = _company()
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False, index=True)
    requested_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(12), default="pending")  # pending | approved | rejected | ended
    decided_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    decision_note = Column(Text)
    started_at = _ts(nullable=True)
    ended_at = _ts(nullable=True)
    created_at = _ts(default=utcnow)


class LocationPing(Base):
    __tablename__ = "location_pings"
    id = _pk()
    company_id = _company()
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    accuracy_m = Column(Float)
    recorded_at = _ts(nullable=False)
    received_at = _ts(default=utcnow)
    __table_args__ = (Index("ix_pings_user_time", "user_id", "recorded_at"),)


class WorkReport(Base):
    __tablename__ = "work_reports"
    id = _pk()
    company_id = _company()
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False, index=True)
    technician_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    resolution = Column(String(60), nullable=False)
    notes = Column(Text)
    checklist_json = Column(Text, default="[]")  # [{label, done}]
    parts_used = Column(Text)
    version = Column(Integer, default=1)
    submitted_at = _ts(default=utcnow)


class JobEvidence(Base):
    __tablename__ = "job_evidence"
    id = _pk()
    company_id = _company()
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False, index=True)
    uploader_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    kind = Column(String(10), nullable=False)  # before | after | other
    stored_name = Column(String(120), nullable=False)
    original_name = Column(String(200))
    mime = Column(String(40), nullable=False)
    size = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    created_at = _ts(default=utcnow)


class ScoringVersion(Base):
    __tablename__ = "scoring_versions"
    id = _pk()
    company_id = _company()
    version = Column(Integer, nullable=False)
    weights_json = Column(Text, nullable=False)
    note = Column(Text)
    effective_from = _ts(default=utcnow)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    __table_args__ = (UniqueConstraint("company_id", "version"),)


class PerformanceScore(Base):
    __tablename__ = "performance_scores"
    id = _pk()
    company_id = _company()
    technician_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=False, unique=True)
    scoring_version = Column(Integer, nullable=False)
    dimensions_json = Column(Text, nullable=False)   # {dim: 0..100}
    adjustments_json = Column(Text, default="[]")    # [{factor, effect, text}]
    total = Column(Float, nullable=False)
    override_total = Column(Float, nullable=True)
    override_note = Column(Text)
    explanation = Column(Text)
    created_at = _ts(default=utcnow)


class Appeal(Base):
    __tablename__ = "appeals"
    id = _pk()
    company_id = _company()
    score_id = Column(String(36), ForeignKey("performance_scores.id"), nullable=False)
    technician_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(12), default="open")  # open | accepted | rejected
    decided_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    decision_note = Column(Text)
    created_at = _ts(default=utcnow)
    decided_at = _ts(nullable=True)


class Notification(Base):
    __tablename__ = "notifications"
    id = _pk()
    company_id = _company()
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(30), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(Text)
    priority = Column(String(10), default="medium")
    job_id = Column(String(36), ForeignKey("jobs.id"), nullable=True)
    created_at = _ts(default=utcnow)
    read_at = _ts(nullable=True)


class CompanySetting(Base):
    __tablename__ = "company_settings"
    id = _pk()
    company_id = _company()
    key = Column(String(60), nullable=False)
    value_json = Column(Text, nullable=False)
    __table_args__ = (UniqueConstraint("company_id", "key"),)


class SyncReceipt(Base):
    """Makes offline-sync replays idempotent."""
    __tablename__ = "sync_receipts"
    id = _pk()
    company_id = _company()
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    client_id = Column(String(80), nullable=False)
    result_json = Column(Text, nullable=False)
    created_at = _ts(default=utcnow)
    __table_args__ = (UniqueConstraint("user_id", "client_id"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = _pk()
    company_id = _company()
    actor_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    action = Column(String(80), nullable=False)
    entity = Column(String(40))
    entity_id = Column(String(36))
    before_json = Column(Text)
    after_json = Column(Text)
    created_at = _ts(default=utcnow, index=True)
