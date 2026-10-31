from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent / "resources"
PROMPTS = Path(__file__).resolve().parent / "agents" / "prompts"
FIXTURES = ROOT / "backend" / "fixtures"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TARIFF_", extra="ignore")
    database_url: str = "sqlite:///./data/app.db"
    timezone: str = "Asia/Shanghai"
    as_of_date: date | None = None
    collector_mode: str = "live"
    scheduler_enabled: bool = True
    seed_sample_orders: bool = True
    local_port: int = 8000
    cors_origins: str = "http://127.0.0.1:3000,http://localhost:3000"

    @property
    def today(self):
        return self.as_of_date or datetime.now(ZoneInfo(self.timezone)).date()

    @property
    def origins(self):
        return self.cors_origins.split(",")


def now():
    return datetime.now(ZoneInfo("Asia/Shanghai")).isoformat()
