import os
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.integration


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_initial_migration_applies() -> None:
    assert TEST_DATABASE_URL is not None
    config_path = Path(__file__).parents[2] / "alembic.ini"
    config = Config(config_path)
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)

    original_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    try:
        command.upgrade(config, "head")
    finally:
        if original_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = original_database_url

    engine = sa.create_engine(TEST_DATABASE_URL)
    try:
        assert "system_metadata" in sa.inspect(engine).get_table_names()
    finally:
        engine.dispose()
