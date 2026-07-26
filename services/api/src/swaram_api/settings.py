from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_DATABASE_URL = "postgresql+psycopg://swaram:swaram@localhost:5432/swaram"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = DEVELOPMENT_DATABASE_URL
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    private_data_root: Path = Path("data")
    upload_max_bytes: int = Field(default=100 * 1024 * 1024, gt=0)
    audio_max_duration_seconds: int = Field(default=15 * 60, gt=0)
    decoded_audio_max_bytes: int = Field(default=200 * 1024 * 1024, gt=0)
    max_audio_assets_per_session: int = Field(default=3, gt=0)
    rate_limit_requests: int = Field(default=120, gt=0)
    rate_limit_window_seconds: int = Field(default=60, gt=0)
    session_retention_hours: int = Field(default=24, gt=0)
    ffprobe_binary: str = "ffprobe"

    @model_validator(mode="after")
    def reject_development_database_in_production(self) -> "Settings":
        if self.app_env == "production" and self.database_url == DEVELOPMENT_DATABASE_URL:
            raise ValueError("DATABASE_URL must be explicitly configured in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
