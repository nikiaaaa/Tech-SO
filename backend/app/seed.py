"""Demo data. Everything here is fictional: companies, banks, people, addresses and incidents.
Run:  python -m app.seed [--reset]
Technician positions are NOT seeded: the map only shows positions reported by a real device or scripts/simulate_gps.py."""
import io
import json
import shutil
import struct
import sys
import uuid
import zlib
from datetime import timedelta

from sqlalchemy import select, update

from .config import settings
from .db import Base, SessionLocal, engine
from .models import (Appeal, AtmDevice, Bank, Branch, Company, IncidentCategory, Job, JobAssignment, JobEvent, Notification,
                     PerformanceScore, Shift, SlaPolicy, Team, TeamMember, User)
from .security import hash_password
from .services import evidence, jobs, sla, sla_ops, performance
from .services.core import put_setting
from .timeutil import now

DOMAIN = "demo.techso.local"

PEOPLE = [
    ("admin", "Rina Admin", "super_admin", []), ("manager", "Hendra Gunawan", "management", []),
    ("supervisor", "Sari Wulandari", "supervisor", []), ("scheduler", "Budi Santoso", "scheduler", []),
    ("tech1", "Asep Pratama", "technician", ["ATM", "CRM", "cash_dispenser"]),
    ("tech2", "Dedi Kurniawan", "technician", ["ATM", "card_reader"]),
    ("tech3", "Eka Wijaya", "technician", ["CRM", "ATM"]),
    ("tech4", "Fajar Hidayat", "technician", ["ATM"]),
    ("tech5", "Gita Lestari", "technician", ["CRM"]),
]
BANKS = [("Bank Demo Alpha", "ALPHA"), ("Bank Demo Beta", "BETA"), ("Bank Demo Gamma", "GAMMA")]
BRANCHES = [("KC Sudirman (demo)", "Jakarta Pusat"), ("KC Kuningan (demo)", "Jakarta Selatan"), ("KCP Senayan (demo)", "Jakarta Selatan"),
            ("KC Kemayoran (demo)", "Jakarta Pusat"), ("KCP Cempaka (demo)", "Jakarta Timur"), ("KC Kebayoran (demo)", "Jakarta Selatan")]
# (code suffix, type, lat, lon) around central Jakarta; all addresses are placeholders
DEVICES = [("ALP-001", "ATM", -6.2088, 106.8456), ("ALP-002", "ATM", -6.2246, 106.8300), ("ALP-003", "CRM", -6.2297, 106.8261),
           ("ALP-004", "ATM", -6.1862, 106.8340), ("BET-001", "ATM", -6.2345, 106.8123), ("BET-002", "CRM", -6.2182, 106.8035),
           ("BET-003", "ATM", -6.1754, 106.8272), ("BET-004", "CRM", -6.2441, 106.8000), ("GAM-001", "ATM", -6.2615, 106.8106),
           ("GAM-002", "ATM", -6.1920, 106.8850), ("GAM-003", "CRM", -6.2150, 106.8990), ("GAM-004", "ATM", -6.2700, 106.8430),
           ("ALP-005", "ATM", -6.2000, 106.8230), ("BET-005", "ATM", -6.2530, 106.8420)]
CATEGORIES = [
    ("Cash dispenser error", "ATM", "high", ["Check power", "Check cash dispenser", "Check reject bin", "Run self-test"]),
    ("Card reader fault", "ATM", "medium", ["Check power", "Clean card reader", "Test card read", "Run self-test"]),
    ("Receipt printer issue", "ATM", "low", ["Check paper", "Clean print head", "Print test receipt"]),
    ("Network / connectivity", "ANY", "high", ["Check network cable", "Check router/modem", "Verify host connection"]),
    ("Cash recycler jam", "CRM", "high", ["Check power", "Clear recycler path", "Check bill acceptor", "Run self-test"]),
    ("Bill acceptor fault", "CRM", "medium", ["Check power", "Clean bill acceptor", "Test deposit", "Run self-test"]),
    ("Power failure", "ANY", "critical", ["Check power supply", "Check UPS/battery", "Restore power", "Run self-test"]),
]
# DEMO targets in minutes: response, dispatch, mobilization, travel, repair, verification, total. Tenant-editable; not contractual.
POLICY = {"critical": (10, 10, 10, 30, 30, 15, 60), "high": (15, 20, 15, 45, 60, 30, 120),
          "medium": (30, 40, 30, 90, 120, 60, 240), "low": (60, 60, 45, 120, 240, 120, 480)}


def _png() -> bytes:
    """Small placeholder image; uses Pillow when available for a readable 'DEMO' label."""
    try:
        from PIL import Image, ImageDraw
        im = Image.new("RGB", (480, 300), (228, 232, 238))
        ImageDraw.Draw(im).text((150, 140), "DEMO EVIDENCE (synthetic)", fill=(23, 32, 51))
        buf = io.BytesIO()
        im.save(buf, "PNG")
        return buf.getvalue()
    except Exception:
        def chunk(t, d):
            c = struct.pack(">I", len(d)) + t + d
            return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
        return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(b"\x00\xe4\xe8\xee")) + chunk(b"IEND", b""))


class Seeder:
    def __init__(self, db):
        self.db, self.cid = db, None
        self.users: dict[str, User] = {}
        self.devices: dict[str, AtmDevice] = {}
        self.cats: dict[str, IncidentCategory] = {}
        self.png = _png()

    # -------- reference data
    def reference(self):
        db = self.db
        co = Company(name="PT Demo Teknik Nusantara (DEMO DATA)", is_demo=True)
        db.add(co)
        db.flush()
        self.cid = co.id
        banks = {}
        for name, code in BANKS:
            b = Bank(company_id=self.cid, name=name, code=code)
            db.add(b)
            banks[code] = b
        db.flush()
        brs = []
        for i, (name, city) in enumerate(BRANCHES):
            br = Branch(company_id=self.cid, bank_id=list(banks.values())[i % 3].id, name=name, city=city, address=f"Jl. Contoh No. {i + 1} (placeholder)")
            db.add(br)
            brs.append(br)
        db.flush()
        for i, (suffix, typ, lat, lon) in enumerate(DEVICES):
            code = f"{typ}-{suffix}"
            bank = banks[suffix[:3].replace("ALP", "ALPHA").replace("BET", "BETA").replace("GAM", "GAMMA")]
            d = AtmDevice(company_id=self.cid, bank_id=bank.id, branch_id=brs[i % len(brs)].id, code=code, device_type=typ,
                          model="Demo-X" + str(100 + i), address=f"Jl. Contoh No. {10 + i}, Jakarta (placeholder)", lat=lat, lon=lon,
                          status="degraded" if i in (1, 5, 9) else "online")
            db.add(d)
            self.devices[code] = d
        for name, typ, prio, checklist in CATEGORIES:
            c = IncidentCategory(company_id=self.cid, name=name, device_type=typ, default_priority=prio, checklist_json=json.dumps(checklist))
            db.add(c)
            self.cats[name] = c
        for prio, (r, d, m, t, rp, v, tot) in POLICY.items():
            db.add(SlaPolicy(company_id=self.cid, name=f"Demo policy — {prio}", priority=prio, response_min=r, dispatch_min=d,
                             mobilization_min=m, travel_min=t, repair_min=rp, verification_min=v, total_min=tot, warning_pct=80))
        for slug, name, role, skills in PEOPLE:
            u = User(company_id=self.cid, email=f"{slug}@{DOMAIN}", full_name=name, role=role, skills=json.dumps(skills),
                     password_hash=hash_password(settings.demo_password), phone="+62 000-0000-" + str(1000 + len(self.users)))
            db.add(u)
            self.users[slug] = u
        db.flush()
        for tname, members in (("Team Jakarta Pusat", ["tech1", "tech2", "tech3"]), ("Team Jakarta Selatan", ["tech4", "tech5"])):
            t = Team(company_id=self.cid, name=tname, supervisor_id=self.users["supervisor"].id)
            db.add(t)
            db.flush()
            for m in members:
                db.add(TeamMember(company_id=self.cid, team_id=t.id, user_id=self.users[m].id))
        put_setting(db, self.cid, "general", {"timezone": "Asia/Jakarta", "language": "en", "display_name": "PT Demo Teknik Nusantara", "require_after_photo": True})
        performance.active_version(db, self.cid)
        n = now()
        for slug in ("tech1", "tech2", "tech3", "tech4"):
            db.add(Shift(company_id=self.cid, user_id=self.users[slug].id, starts_at=n - timedelta(hours=1), ends_at=n + timedelta(hours=7),
                         status="active", started_at=n - timedelta(hours=1)))
        for slug in ("tech1", "tech2", "tech3", "tech4", "tech5"):
            db.add(Shift(company_id=self.cid, user_id=self.users[slug].id, starts_at=n + timedelta(days=1, hours=1), ends_at=n + timedelta(days=1, hours=9)))
        db.commit()

    # -------- jobs with a believable timeline
    def job(self, device, cat, prio, desc, age_min, steps, tech=None):
        tname = tech or next((s[2] for s in steps if s[0] == "assign"), None)
        db, S, T = self.db, self.users["scheduler"], self.users.get(tname) if tname else None
        base = now() - timedelta(minutes=age_min)
        seen_e, seen_a = set(), set()

        def stamp(offset):
            t = base + timedelta(minutes=offset)
            for e in db.scalars(select(JobEvent).where(JobEvent.job_id == job.id)):
                if e.id not in seen_e:
                    e.occurred_at = e.created_at = t
                    seen_e.add(e.id)
            for a in db.scalars(select(JobAssignment).where(JobAssignment.job_id == job.id)):
                if a.id not in seen_a:
                    a.assigned_at = t
                    seen_a.add(a.id)
            db.flush()

        job = jobs.create_job(db, S, self.devices[device].id, self.cats[cat].id, prio, desc)
        job.created_at = base
        stamp(0)
        checklist = [{"label": x, "done": True} for x in json.loads(self.cats[cat].checklist_json)]
        for kind, off, *arg in steps:
            if kind == "assign":
                jobs.assign(db, S, job.id, self.users[arg[0]].id, None)
            elif kind == "reject":
                jobs.reject(db, self.users[arg[0]], job.id, arg[1])
            elif kind == "reassign":
                jobs.reassign(db, S, job.id, self.users[arg[0]].id, arg[1])
            elif kind == "cancel":
                jobs.cancel(db, S, job.id, arg[0])
            elif kind == "verify":
                jobs.verify(db, S, job.id)
            elif kind == "correct":
                jobs.request_correction(db, S, job.id, arg[0])
            elif kind == "photo_before":
                evidence.save(db, T, job.id, "before", "before.png", self.png)
            elif kind == "photo_after":
                evidence.save(db, T, job.id, "after", "after.png", self.png)
            elif kind == "hold":
                jobs.hold(db, T, job.id, arg[0], None)
            elif kind == "resolve":
                jobs.resolve(db, T, job.id, "repaired", "Replaced faulty module and ran full self-test; device back online. (demo)", checklist if not arg else checklist[:-1] + [{"label": checklist[-1]["label"], "done": False}], None)
            else:
                getattr(jobs, kind)(db, T, job.id)
            stamp(off)
        sla.compute(db, job)
        if job.status == "CLOSED":
            job.closed_at = base + timedelta(minutes=steps[-1][1])
        db.commit()
        return job

    def run(self):
        d = self.job
        # ---- closed history (older, with varied outcomes)
        happy = lambda t, a, b: [("assign", 6, t), ("accept", 9), ("start_journey", 13), ("arrive", 13 + a), ("start_work", 15 + a), ("photo_before", 15 + a),
                                 ("photo_after", 40 + a + b), ("resolve", 42 + a + b), ("verify", 50 + a + b)]
        d("ATM-ALP-001", "Cash dispenser error", "high", "Dispenser reports cassette 2 jam; cash withdrawal unavailable.", 60 * 70, happy("tech1", 25, 20))
        d("CRM-ALP-003", "Cash recycler jam", "high", "Recycler stopped during deposit; customer funds pending.", 60 * 52, happy("tech3", 30, 25))
        d("ATM-BET-001", "Card reader fault", "medium", "Card reader rejects chip cards intermittently.", 60 * 46, happy("tech2", 40, 35))
        d("ATM-BET-003", "Power failure", "critical", "ATM offline after site power loss.", 60 * 30, happy("tech1", 70, 40))        # breach
        d("CRM-BET-004", "Bill acceptor fault", "medium", "Bill acceptor not reading notes.", 60 * 26, happy("tech5", 35, 30))
        d("ATM-GAM-001", "Receipt printer issue", "low", "Receipt printer out of paper alarm persists after refill.", 60 * 20, happy("tech4", 30, 25))
        d("ATM-GAM-004", "Network / connectivity", "high", "Intermittent host timeouts.", 60 * 9, [("assign", 5, "tech2"), ("accept", 8), ("start_journey", 12), ("arrive", 40), ("start_work", 42),
                                                                                                           ("photo_before", 42), ("hold", 70, "connectivity_issue"), ("resume", 100), ("photo_after", 125), ("resolve", 130), ("verify", 150)])
        # ---- awaiting verification
        d("ATM-ALP-002", "Card reader fault", "medium", "Card jam reported by customers.", 150, happy("tech2", 20, 15)[:-1])
        d("CRM-GAM-003", "Cash recycler jam", "high", "Notes stuck in recycler transport.", 110, happy("tech3", 15, 12)[:-1])
        # ---- in the field right now
        d("ATM-ALP-004", "Cash dispenser error", "critical", "Dispenser fault: ATM out of service during peak hours.", 70,
          [("assign", 3, "tech1"), ("accept", 5), ("start_journey", 8), ("arrive", 30), ("start_work", 34), ("photo_before", 34)], "tech1")           # breach in progress
        d("ATM-BET-005", "Network / connectivity", "high", "ATM shows 'temporarily unavailable'.", 100,
          [("assign", 4, "tech4"), ("accept", 8), ("start_journey", 14), ("arrive", 50), ("start_work", 60), ("photo_before", 60), ("hold", 75, "site_access_delay")], "tech4")
        d("CRM-BET-002", "Bill acceptor fault", "medium", "Bill acceptor reads fewer notes than inserted.", 45,
          [("assign", 3, "tech3"), ("accept", 6), ("start_journey", 10)], "tech3")
        d("ATM-ALP-005", "Receipt printer issue", "low", "Receipt printer prints blank slips.", 25, [("assign", 4, "tech2"), ("accept", 10)], "tech2")
        # ---- waiting for an answer (one beyond the accept timeout so escalation can be demonstrated)
        d("ATM-GAM-002", "Power failure", "critical", "ATM dark, UPS beeping.", 18, [("assign", 5, "tech1")], "tech1")
        d("CRM-GAM-003", "Bill acceptor fault", "medium", "Acceptor jams on high-denomination notes.", 8, [("assign", 6, "tech5")], "tech5")
        # ---- rejected then reassigned
        d("ATM-BET-001", "Cash dispenser error", "high", "Cassette 1 count mismatch.", 35,
          [("assign", 3, "tech4"), ("reject", 6, "tech4", "Vehicle breakdown, cannot reach site"), ("reassign", 9, "tech2", "Reassigned after rejection")], "tech2")
        # ---- unassigned
        d("ATM-ALP-001", "Power failure", "critical", "Power loss reported by branch staff.", 6, [])
        d("CRM-ALP-003", "Cash recycler jam", "medium", "Jam warning on recycler, still accepting small notes.", 12, [])
        # ---- cancelled
        d("ATM-BET-003", "Receipt printer issue", "low", "Duplicate report of an already-fixed issue.", 60 * 5, [("cancel", 20, "Duplicate of an existing job")])
        # ---- pending SLA pause request on the breached job + an appeal
        db = self.db
        bad = db.scalar(select(Job).where(Job.description.like("Dispenser fault: ATM out of service%")))
        sla_ops.request_pause(db, self.users["scheduler"], bad.id, "Branch denied site access until the manager arrives (documented by phone).")
        score = db.scalar(select(PerformanceScore).join(Job, Job.id == PerformanceScore.job_id).where(Job.description.like("ATM offline after site power loss%")))
        if score:
            performance.create_appeal(db, self.users["tech1"], score.id, "Site power was restored by the utility late; my arrival was on time.")
        db.execute(update(Notification).where(Notification.kind != "assignment").values(read_at=now()))
        db.execute(update(Notification).where(Notification.job_id.in_(select(Job.id).where(Job.status.in_(["CLOSED", "CANCELLED", "VERIFICATION"])))).values(read_at=now()))
        db.commit()


def _is_uuid(name: str) -> bool:
    try:
        return str(uuid.UUID(name)) == name
    except ValueError:
        return False


def seed(reset: bool = False) -> None:
    if reset:
        Base.metadata.drop_all(engine)
        # photos belong to the rows just dropped. Only per-company folders (UUID names) are removed, never anything
        # else that may live in a misconfigured TECHSO_EVIDENCE_DIR.
        if settings.evidence_dir.is_dir():
            for child in settings.evidence_dir.iterdir():
                if child.is_dir() and _is_uuid(child.name):
                    shutil.rmtree(child)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.scalar(select(Company.id)):
            print("Data already present. Use --reset to rebuild the demo dataset.")
            return
        s = Seeder(db)
        s.reference()
        s.run()
        print(f"Demo data created. Accounts: <role>@{DOMAIN}  (admin, manager, supervisor, scheduler, tech1..tech5)")
        print("Demo password is set by TECHSO_DEMO_PASSWORD (default in app/config.py). Demo only, never use in production.")
    finally:
        db.close()


if __name__ == "__main__":
    if settings.env == "production":
        sys.exit("Refusing to seed demo data when TECHSO_ENV=production")
    seed("--reset" in sys.argv)
