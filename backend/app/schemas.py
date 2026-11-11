"""Request bodies. Strict lengths and enums at the trust boundary; unknown fields are rejected."""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field

Priority = Literal["critical", "high", "medium", "low"]
Role = Literal["super_admin", "management", "supervisor", "scheduler", "technician"]
DeviceType = Literal["ATM", "CRM"]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginIn(Body):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


class JobCreate(Body):
    device_id: str = Field(max_length=36)
    category_id: Optional[str] = Field(None, max_length=36)
    priority: Priority
    description: str = Field(min_length=5, max_length=2000)


class AssignIn(Body):
    technician_id: str = Field(max_length=36)
    note: Optional[str] = Field(None, max_length=500)


class ReassignIn(Body):
    technician_id: str = Field(max_length=36)
    reason: str = Field(min_length=3, max_length=500)


class ReasonIn(Body):
    reason: str = Field(min_length=3, max_length=500)


class HoldIn(Body):
    reason_code: str = Field(max_length=40)
    note: Optional[str] = Field(None, max_length=500)


class ResolveIn(Body):
    resolution: str = Field(max_length=60)
    notes: str = Field(max_length=4000)
    checklist: list[dict] = Field(default_factory=list, max_length=60)
    parts_used: Optional[str] = Field(None, max_length=500)


class PingIn(Body):
    lat: float
    lon: float
    accuracy_m: Optional[float] = Field(None, ge=0, le=100000)
    recorded_at: Optional[datetime] = None
    job_id: Optional[str] = Field(None, max_length=36)


class SyncIn(Body):
    actions: list[dict] = Field(max_length=200)


class PreviewIn(Body):
    device_id: str
    category_id: Optional[str] = None
    priority: Priority


class DeviceIn(Body):
    bank_id: str
    branch_id: Optional[str] = None
    code: str = Field(min_length=2, max_length=60)
    device_type: DeviceType
    model: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=255)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    status: Literal["online", "degraded", "offline", "maintenance"] = "online"


class DevicePatch(Body):
    branch_id: Optional[str] = None
    model: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=255)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    status: Optional[Literal["online", "degraded", "offline", "maintenance"]] = None


class CsvImportIn(Body):
    csv: str = Field(max_length=200000)


class CategoryIn(Body):
    name: str = Field(min_length=2, max_length=120)
    device_type: Literal["ATM", "CRM", "ANY"] = "ANY"
    default_priority: Priority = "medium"
    checklist: list[str] = Field(default_factory=list, max_length=40)


class BankIn(Body):
    name: str = Field(min_length=2, max_length=150)
    code: str = Field(min_length=2, max_length=30)


class BranchIn(Body):
    bank_id: str
    name: str = Field(min_length=2, max_length=150)
    city: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=255)


class SlaPolicyIn(Body):
    name: str = Field(min_length=2, max_length=150)
    bank_id: Optional[str] = None
    device_type: Optional[DeviceType] = None
    category_id: Optional[str] = None
    priority: Priority
    response_min: int = Field(ge=1, le=100000)
    dispatch_min: int = Field(ge=1, le=100000)
    mobilization_min: int = Field(ge=1, le=100000)
    travel_min: int = Field(ge=1, le=100000)
    repair_min: int = Field(ge=1, le=100000)
    verification_min: int = Field(ge=1, le=100000)
    total_min: int = Field(ge=1, le=100000)
    warning_pct: int = Field(80, ge=1, le=99)
    active: bool = True


class PauseRequestIn(Body):
    reason: str = Field(min_length=10, max_length=500)


class DecisionIn(Body):
    approve: bool
    note: str = Field(min_length=3, max_length=500)


class AppealIn(Body):
    reason: str = Field(min_length=10, max_length=1000)


class AppealDecisionIn(Body):
    accept: bool
    note: str = Field(min_length=3, max_length=500)
    new_total: Optional[float] = Field(None, ge=0, le=100)


class ScoringIn(Body):
    weights: dict[str, float]
    params: Optional[dict] = None
    note: Optional[str] = Field(None, max_length=300)


class UserCreate(Body):
    email: str = Field(max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=2, max_length=150)
    role: Role
    password: str = Field(max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    skills: list[str] = Field(default_factory=list, max_length=30)


class UserPatch(Body):
    full_name: Optional[str] = Field(None, min_length=2, max_length=150)
    role: Optional[Role] = None
    is_active: Optional[bool] = None
    phone: Optional[str] = Field(None, max_length=40)
    skills: Optional[list[str]] = Field(None, max_length=30)
    password: Optional[str] = Field(None, max_length=200)


class MePatch(Body):
    phone: Optional[str] = Field(None, max_length=40)
    password: Optional[str] = Field(None, max_length=200)
    current_password: Optional[str] = Field(None, max_length=200)


class TeamIn(Body):
    name: str = Field(min_length=2, max_length=100)
    supervisor_id: Optional[str] = None


class MemberIn(Body):
    user_id: str


class ShiftIn(Body):
    user_id: str
    starts_at: datetime
    ends_at: datetime


class GpsPolicyIn(Body):
    enabled: bool
    min_interval_s: int = Field(ge=1, le=3600)
    max_accuracy_m: int = Field(ge=5, le=5000)
    stale_after_s: int = Field(ge=30, le=86400)
    retention_days: int = Field(ge=1, le=3650)


class NotificationRulesIn(Body):
    accept_timeout_min: int = Field(ge=1, le=1440)
    repeat_interval_min: int = Field(ge=1, le=1440)
    escalate_to_roles: list[Literal["supervisor", "scheduler", "management", "super_admin"]] = Field(min_length=1)
    high_priority_sound: bool = True


class GeneralIn(Body):
    timezone: str = Field(max_length=60)
    language: Literal["en", "id"] = "en"
    display_name: str = Field("", max_length=150)
    require_after_photo: bool = True
