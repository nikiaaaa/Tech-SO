"""Evidence storage. Files are validated by magic bytes, stored under a generated name outside the web root,
and served only through an authorized endpoint."""
import hashlib
import uuid
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Job, JobEvidence, User
from ..security import require
from .core import audit, get_owned
from .jobs import get_job

KINDS = ("before", "after", "other")
UPLOAD_STATUSES = {"ARRIVED", "IN_PROGRESS", "ON_HOLD"}
MAX_PER_JOB = 30


def _detect(data: bytes) -> tuple[str, str] | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def save(db: Session, actor: User, job_id: str, kind: str, original_name: str | None, data: bytes) -> JobEvidence:
    job = get_job(db, actor, job_id)
    if actor.role != "technician" or job.assigned_to != actor.id:
        raise HTTPException(403, "Only the assigned technician can upload evidence")
    if job.status not in UPLOAD_STATUSES:
        raise HTTPException(409, f"Evidence can be added while on site (job is {job.status})")
    if kind not in KINDS:
        raise HTTPException(422, f"kind must be one of {', '.join(KINDS)}")
    if not data:
        raise HTTPException(422, "Empty file")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File larger than {settings.max_upload_mb} MB")
    detected = _detect(data)
    if not detected:
        raise HTTPException(415, "Only JPEG, PNG or WebP images are accepted")
    if (db.scalar(select(func.count()).select_from(JobEvidence).where(JobEvidence.job_id == job.id)) or 0) >= MAX_PER_JOB:
        raise HTTPException(409, "Evidence limit reached for this job")
    mime, ext = detected
    stored = f"{uuid.uuid4().hex}.{ext}"
    folder = Path(settings.evidence_dir) / job.company_id / job.id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / stored).write_bytes(data)
    ev = JobEvidence(company_id=job.company_id, job_id=job.id, uploader_id=actor.id, kind=kind, stored_name=stored,
                     original_name=(original_name or "")[:200] or None, mime=mime, size=len(data),
                     sha256=hashlib.sha256(data).hexdigest())
    db.add(ev)
    db.flush()
    audit(db, actor, "evidence.uploaded", "evidence", ev.id, None, {"job": job.code, "kind": kind, "size": len(data)})
    return ev


def locate(db: Session, actor: User, evidence_id: str) -> tuple[Path, str]:
    ev = get_owned(db, JobEvidence, evidence_id, actor.company_id)
    job = db.get(Job, ev.job_id)
    if actor.role == "technician":
        if job.assigned_to != actor.id:
            raise HTTPException(404, "Evidence not found")
    else:
        require(actor, "jobs:read")
    path = Path(settings.evidence_dir) / ev.company_id / ev.job_id / ev.stored_name
    if not path.is_file():
        raise HTTPException(404, "File missing from storage")
    return path, ev.mime
