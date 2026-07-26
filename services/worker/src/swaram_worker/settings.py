from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_DATABASE_URL = "postgresql+psycopg://swaram:swaram@localhost:5432/swaram"


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = DEVELOPMENT_DATABASE_URL
    worker_poll_interval_seconds: float = 2.0
    private_data_root: Path = Path("data")
    stem_device: Literal["auto", "cpu", "cuda", "mps"] = "cpu"

    @model_validator(mode="after")
    def validate_runtime_values(self) -> "WorkerSettings":
        if self.worker_poll_interval_seconds <= 0:
            raise ValueError("WORKER_POLL_INTERVAL_SECONDS must be positive")
        if self.app_env == "production" and self.database_url == DEVELOPMENT_DATABASE_URL:
            raise ValueError("DATABASE_URL must be explicitly configured in production")
        return self
