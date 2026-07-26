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
