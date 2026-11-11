from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TECHSO_", extra="ignore")

    env: str = "dev"  # dev | production
    database_url: str = f"sqlite:///{BASE_DIR / 'data' / 'techso.db'}"
    # Dev-only default. In production TECHSO_SECRET_KEY must be set (checked at startup).
    secret_key: str = "dev-only-insecure-secret-change-me-0123456789"
    access_token_minutes: int = 60
    # Technicians work a shift, often with poor signal: a longer session avoids losing sign-in while offline.
    technician_token_minutes: int = 720
    # Built web app (npm run build). When present the API also serves it, so one process on one port runs everything.
    frontend_dist: Path = BASE_DIR.parent / "frontend" / "dist"
    evidence_dir: Path = BASE_DIR / "data" / "evidence"
    max_upload_mb: int = 8
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    login_max_failures: int = 5
    login_lock_minutes: int = 15
    login_rate_per_minute: int = 20
    rate_limit_per_minute: int = 600
    escalation_sweep_seconds: int = 60
    # Demo data only. Never used when env == "production".
    demo_password: str = "TechSO-demo-1"


settings = Settings()


def assert_production_safe() -> None:
    if settings.env == "production" and settings.secret_key.startswith("dev-only"):
        raise RuntimeError("TECHSO_SECRET_KEY must be set when TECHSO_ENV=production")
