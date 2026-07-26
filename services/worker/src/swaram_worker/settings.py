from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
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
    worker_poll_interval_seconds: float = Field(default=2.0, gt=0, le=60)
    job_lease_seconds: int = Field(default=120, ge=30, le=3_600)
    private_data_root: Path = Path("data")
    worker_temp_root: Path | None = None
    stem_device: Literal["auto", "cpu", "cuda", "mps"] = "cpu"
    audio_max_bytes: int = Field(default=100 * 1024 * 1024, gt=0, le=500 * 1024 * 1024)
    audio_max_duration_seconds: int = Field(default=15 * 60, gt=0, le=60 * 60)
    decoded_audio_max_bytes: int = Field(default=200 * 1024 * 1024, gt=0, le=2 * 1024 * 1024 * 1024)
    ffmpeg_timeout_seconds: float = Field(default=120, gt=0, le=3_600)
    demucs_timeout_seconds: float = Field(default=30 * 60, gt=0, le=3 * 60 * 60)

    @model_validator(mode="after")
    def validate_runtime_values(self) -> "WorkerSettings":
        if self.app_env != "production":
            return self
        if self.database_url == DEVELOPMENT_DATABASE_URL:
            raise ValueError("DATABASE_URL must be explicitly configured in production")
        if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("DATABASE_URL must use PostgreSQL in production")
        if not self.private_data_root.is_absolute():
            raise ValueError("PRIVATE_DATA_ROOT must be absolute in production")
        if self.worker_temp_root is None or not self.worker_temp_root.is_absolute():
            raise ValueError("WORKER_TEMP_ROOT must be absolute in production")
        return self
