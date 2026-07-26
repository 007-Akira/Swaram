import pytest
from pydantic import ValidationError
from swaram_api.settings import DEVELOPMENT_DATABASE_URL, Settings


def test_development_settings_have_safe_local_defaults() -> None:
    settings = Settings(_env_file=None)
    assert settings.app_env == "development"
    assert settings.database_url == DEVELOPMENT_DATABASE_URL


def test_production_rejects_development_database_default() -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL"):
        Settings(app_env="production", _env_file=None)


def test_production_requires_absolute_storage_and_exact_https_cors() -> None:
    production = {
        "app_env": "production",
        "database_url": "postgresql+psycopg://user:secret@db/swaram",
        "_env_file": None,
    }
    with pytest.raises(ValidationError, match="PRIVATE_DATA_ROOT"):
        Settings(**production, private_data_root="relative", cors_origins=["https://app.test"])
    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        Settings(**production, private_data_root="/data", cors_origins=["http://app.test"])
    settings = Settings(
        **production,
        private_data_root="/data",
        cors_origins=["https://practice.example"],
    )
    assert settings.cors_origins == ["https://practice.example"]
