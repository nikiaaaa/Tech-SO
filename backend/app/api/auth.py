from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Company, User
from ..schemas import LoginIn
from ..security import create_token, current_user, check_login_rate, token_minutes, verify_password
from ..services.core import audit
from ..timeutil import now, aware

router = APIRouter(prefix="/auth", tags=["auth"])

# One generic message for every credential failure so the API does not reveal which emails exist.
_BAD = "Invalid email or password"


def user_out(db: Session, u: User) -> dict:
    c = db.get(Company, u.company_id)
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "phone": u.phone,
            "company": {"id": c.id, "name": c.name, "is_demo": c.is_demo} if c else None}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    check_login_rate(request.client.host if request.client else "unknown")
    u = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if u and u.locked_until and aware(u.locked_until) > now():
        raise HTTPException(423, "Account temporarily locked. Try again later.")
    if not u or not u.is_active or not verify_password(body.password, u.password_hash):
        if u:
            u.failed_logins = (u.failed_logins or 0) + 1
            if u.failed_logins >= settings.login_max_failures:
                u.locked_until = now() + timedelta(minutes=settings.login_lock_minutes)
                u.failed_logins = 0
                audit(db, None, "auth.locked", "user", u.id, company_id=u.company_id)
            db.commit()
        raise HTTPException(401, _BAD)
    u.failed_logins, u.locked_until = 0, None
    audit(db, u, "auth.login", "user", u.id)
    db.commit()
    return {"access_token": create_token(u), "token_type": "bearer", "expires_in": token_minutes(u) * 60,
            "user": user_out(db, u)}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_out(db, user)


@router.post("/refresh")
def refresh(user: User = Depends(current_user)):
    return {"access_token": create_token(user), "token_type": "bearer", "expires_in": token_minutes(user) * 60}


@router.post("/logout")
def logout(user: User = Depends(current_user), db: Session = Depends(get_db)):
    # Tokens are stateless; the client discards its token. Logout is recorded for the audit trail.
    audit(db, user, "auth.logout", "user", user.id)
    db.commit()
    return {"ok": True}
