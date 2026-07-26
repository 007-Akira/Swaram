import os

import pytest
from sqlalchemy import create_engine
from swaram_worker.main import Worker

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.integration


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_worker_connects_polls_once_and_exits() -> None:
    assert TEST_DATABASE_URL is not None
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    try:
        Worker(engine).poll_once()
    finally:
        engine.dispose()
