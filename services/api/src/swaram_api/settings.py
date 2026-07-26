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
    upload_max_bytes: int = Field(default=100 * 1024 * 1024, gt=0, le=500 * 1024 * 1024)
    max_audio_assets_per_session: int = Field(default=3, gt=0, le=10)
    rate_limit_requests: int = Field(default=120, gt=0, le=10_000)
    rate_limit_window_seconds: int = Field(default=60, gt=0, le=3_600)
    session_retention_hours: int = Field(default=24, gt=0, le=168)

    @model_validator(mode="after")
    def reject_unsafe_production_settings(self) -> "Settings":
        if self.app_env != "production":
            return self
        if self.database_url == DEVELOPMENT_DATABASE_URL:
            raise ValueError("DATABASE_URL must be explicitly configured in production")
        if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("DATABASE_URL must use PostgreSQL in production")
        if not self.private_data_root.is_absolute():
            raise ValueError("PRIVATE_DATA_ROOT must be absolute in production")
        if not self.cors_origins or any(
            not origin.startswith("https://") or "*" in origin for origin in self.cors_origins
        ):
            raise ValueError("CORS_ORIGINS must contain exact HTTPS origins in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
