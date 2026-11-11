import hashlib
import hmac
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

# ---------- passwords (stdlib scrypt, no extra dependency) ----------
_N, _R, _P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, h = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, bytes.fromhex(h))
    except Exception:
        return False


def validate_password_strength(password: str) -> None:
    if len(password) < 10:
        raise HTTPException(422, "Password must be at least 10 characters")


# ---------- JWT ----------
def token_minutes(user: User) -> int:
    return settings.technician_token_minutes if user.role == "technician" else settings.access_token_minutes


def create_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=token_minutes(user))
    return jwt.encode({"sub": user.id, "cid": user.company_id, "role": user.role, "exp": exp},
                      settings.secret_key, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")


# ---------- login throttle (per-process; see docs: use a shared store when running >1 worker) ----------
_attempts: dict[str, deque] = defaultdict(deque)


def hit(bucket: str, limit: int) -> bool:
    """Sliding 60 s window. Returns False when the caller is over the limit."""
    now = time.monotonic()
    q = _attempts[bucket]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def check_login_rate(key: str) -> None:
    if not hit("login:" + key, settings.login_rate_per_minute):
        raise HTTPException(429, "Too many login attempts, try again later")


# ---------- RBAC ----------
ALL = "*"
PERMISSIONS: dict[str, set[str]] = {
    "super_admin": {ALL},
    "management": {
        "overview", "jobs:read", "devices:read", "technicians:read", "sla:read", "sla:pause_approve",
        "performance:read_team", "performance:decide", "reports:read", "audit:read", "gps:read_live",
        "settings:read", "scoring:manage", "users:read", "sla:configure",
    },
    "supervisor": {
        "overview", "jobs:read", "jobs:create", "jobs:assign", "jobs:verify", "jobs:cancel",
        "devices:read", "devices:write", "technicians:read", "shifts:manage", "sla:read",
        "sla:pause_request", "sla:pause_approve", "performance:read_team", "performance:decide",
        "reports:read", "gps:read_live", "settings:read", "teams:manage", "users:read", "escalation:run",
        "notifications:configure",
    },
    "scheduler": {
        "overview", "jobs:read", "jobs:create", "jobs:assign", "jobs:verify", "jobs:cancel",
        "devices:read", "devices:write", "technicians:read", "sla:read", "sla:pause_request",
        "reports:read", "gps:read_live", "settings:read",
    },
    "technician": {"jobs:work", "me"},
}


def can(user: User, perm: str) -> bool:
    perms = PERMISSIONS.get(user.role, set())
    return ALL in perms or perm in perms


def require(user: User, perm: str) -> None:
    if not can(user, perm):
        raise HTTPException(403, "Not permitted")


# ---------- request dependency ----------
def current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Not authenticated")
    claims = decode_token(authorization[7:].strip())
    user = db.get(User, claims.get("sub"))
    if not user or not user.is_active or user.company_id != claims.get("cid") or user.role != claims.get("role"):
        raise HTTPException(401, "Invalid session")
    return user
