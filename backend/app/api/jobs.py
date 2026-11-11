from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import AtmDevice, User
from ..schemas import AssignIn, HoldIn, JobCreate, PreviewIn, ReasonIn, ReassignIn, ResolveIn
from ..security import current_user, require
from ..services import evidence as ev_svc, jobs as svc, sla
from ..services.core import get_owned

router = APIRouter(tags=["jobs"])


def _one(db, job, actor):
    db.commit()
    return svc.serialize(db, [job], detail=True)[0]


@router.get("/jobs")
def list_jobs(status: str | None = None, priority: str | None = None, assignee: str | None = None,
              device_id: str | None = None, q: str | None = None, date_from: datetime | None = None,
              date_to: datetime | None = None, sort: str = "-created_at", page: int = 1, page_size: int = 25,
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    return svc.list_jobs(db, user, status=status, priority=priority, assignee=assignee, device_id=device_id, q=q,
                         date_from=date_from, date_to=date_to, sort=sort, page=page, page_size=page_size)


@router.post("/jobs", status_code=201)
def create_job(body: JobCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    job = svc.create_job(db, user, body.device_id, body.category_id, body.priority, body.description)
    return _one(db, job, user)


@router.post("/sla/preview")
def preview(body: PreviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, "jobs:create")
    get_owned(db, AtmDevice, body.device_id, user.company_id)
    return sla.preview(db, user.company_id, body.device_id, body.category_id, body.priority)


@router.get("/jobs/{job_id}")
def get_job(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return svc.serialize(db, [svc.get_job(db, user, job_id)], detail=True)[0]


@router.get("/jobs/{job_id}/events")
def job_events(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return svc.events(db, svc.get_job(db, user, job_id))


@router.get("/jobs/{job_id}/candidates")
def candidates(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return svc.candidates(db, user, job_id)


@router.post("/jobs/{job_id}/assign")
def assign(job_id: str, body: AssignIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.assign(db, user, job_id, body.technician_id, body.note), user)


@router.post("/jobs/{job_id}/reassign")
def reassign(job_id: str, body: ReassignIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.reassign(db, user, job_id, body.technician_id, body.reason), user)


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: str, body: ReasonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.cancel(db, user, job_id, body.reason), user)


@router.post("/jobs/{job_id}/verify")
def verify(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.verify(db, user, job_id), user)


@router.post("/jobs/{job_id}/request-correction")
def request_correction(job_id: str, body: ReasonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.request_correction(db, user, job_id, body.reason), user)


# ---- technician actions
@router.post("/jobs/{job_id}/accept")
def accept(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.accept(db, user, job_id), user)


@router.post("/jobs/{job_id}/reject")
def reject(job_id: str, body: ReasonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.reject(db, user, job_id, body.reason), user)


@router.post("/jobs/{job_id}/start-journey")
def start_journey(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.start_journey(db, user, job_id), user)


@router.post("/jobs/{job_id}/arrive")
def arrive(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.arrive(db, user, job_id), user)


@router.post("/jobs/{job_id}/start-work")
def start_work(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.start_work(db, user, job_id), user)


@router.post("/jobs/{job_id}/hold")
def hold(job_id: str, body: HoldIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.hold(db, user, job_id, body.reason_code, body.note), user)


@router.post("/jobs/{job_id}/resume")
def resume(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.resume(db, user, job_id), user)


@router.post("/jobs/{job_id}/resolve")
def resolve(job_id: str, body: ResolveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _one(db, svc.resolve(db, user, job_id, body.resolution, body.notes, body.checklist, body.parts_used), user)


@router.get("/jobs/{job_id}/report")
def report(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    job = svc.get_job(db, user, job_id)
    return {"report": svc.latest_report(db, job), "evidence": svc.serialize(db, [job], detail=True)[0]["evidence"]}


# ---- evidence
@router.post("/jobs/{job_id}/evidence", status_code=201)
async def upload_evidence(job_id: str, kind: str = Form(...), file: UploadFile = File(...),
                          user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    e = ev_svc.save(db, user, job_id, kind, file.filename, data)
    db.commit()
    return svc.evidence_meta(e)


@router.get("/evidence/{evidence_id}")
def get_evidence(evidence_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    path, mime = ev_svc.locate(db, user, evidence_id)
    return FileResponse(path, media_type=mime, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"})
