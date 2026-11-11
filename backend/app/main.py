import asyncio
import logging
from contextlib import asynccontextmanager

from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text

from .api import admin, auth, jobs, me, ops
from .config import assert_production_safe, settings
from .db import Base, SessionLocal, engine
from .models import Company, User
from .realtime import hub
from .security import decode_token, hit
from .services import gps
from .services.jobs import escalation_sweep

log = logging.getLogger("techso")


def _sweep_all() -> None:
    db = SessionLocal()
    try:
        for cid in db.scalars(select(Company.id)):
            escalation_sweep(db, cid)
    except Exception:
        log.exception("escalation sweep failed")
    finally:
        db.close()


def _purge_all() -> None:
    db = SessionLocal()
    try:
        for cid in db.scalars(select(Company.id)):
            gps.purge_old(db, cid)
        db.commit()
    except Exception:
        log.exception("location retention purge failed")
    finally:
        db.close()


async def _background() -> None:
    ticks = 0
    while True:
        await asyncio.sleep(settings.escalation_sweep_seconds)
        await asyncio.to_thread(_sweep_all)
        ticks += 1
        if ticks % 60 == 0:  # roughly hourly with the default 60 s sweep
            await asyncio.to_thread(_purge_all)


@asynccontextmanager
async def lifespan(_: FastAPI):
    assert_production_safe()
    if settings.env != "production":
        Base.metadata.create_all(engine)  # dev convenience; production uses `alembic upgrade head`
    hub.bind_loop(asyncio.get_running_loop())
    task = asyncio.create_task(_background())
    yield
    task.cancel()


app = FastAPI(title="TechSO API", version="1.0.0", lifespan=lifespan,
              docs_url="/docs" if settings.env != "production" else None, redoc_url=None,
              openapi_url="/openapi.json" if settings.env != "production" else None)

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def guard(request: Request, call_next):
    ip = request.client.host if request.client else "unknown"
    if request.url.path.startswith("/api") and not hit("api:" + ip, settings.rate_limit_per_minute):
        return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)  # no request bodies are logged
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


for r in (auth.router, jobs.router, me.router, ops.router, admin.router):
    app.include_router(r, prefix="/api/v1")


@app.get("/health")
def health():
    """Liveness + database reachability, for uptime checks."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        log.exception("health check: database unreachable")
        return JSONResponse({"status": "degraded", "service": "techso", "database": "unreachable"}, status_code=503)
    return {"status": "ok", "service": "techso", "env": settings.env, "database": "ok"}


def _origin_allowed(origin: str | None, host: str | None) -> bool:
    """Browsers always send Origin on WebSocket handshakes. Accept the configured origins and the page's own host
    (same-origin, e.g. when this API serves the web app or sits behind a proxy); refuse every other site."""
    if not origin:
        return True  # non-browser client (script, native app): the token is still required
    return origin in settings.cors_origins or urlparse(origin).netloc == (host or "")


def _ws_user(token: str):
    claims = decode_token(token)
    db = SessionLocal()
    try:
        u = db.get(User, claims.get("sub"))
        if not u or not u.is_active or u.company_id != claims.get("cid"):
            return None
        return u.id, u.role, u.company_id
    finally:
        db.close()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    if not _origin_allowed(ws.headers.get("origin"), ws.headers.get("host")):  # block cross-site WebSocket hijacking
        await ws.close(code=4403)
        return
    try:
        who = await asyncio.to_thread(_ws_user, token)
    except Exception:
        who = None
    if not who:
        await ws.close(code=4401)
        return
    conn = await hub.connect(ws, *who)
    try:
        while True:
            await ws.receive_text()  # clients only send keep-alive pings
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(conn)


def mount_frontend(application: FastAPI, dist: Path) -> bool:
    """Serve the built web app (frontend/dist) from this process. Registered last, so API routes always win."""
    root = dist.resolve()
    if not (root / "index.html").is_file():
        return False
    if (root / "assets").is_dir():
        application.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

    @application.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith(("api/", "ws", "docs", "openapi.json")):
            raise HTTPException(404, "Not found")
        target = (root / path).resolve()
        if path and target.is_file() and root in target.parents:  # a real file inside dist, never outside it
            return FileResponse(target, headers={"Cache-Control": "no-cache"} if path == "sw.js" else None)
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})  # client-side routes

    return True


mount_frontend(app, settings.frontend_dist)
