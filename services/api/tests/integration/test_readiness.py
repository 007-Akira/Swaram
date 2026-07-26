import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from swaram_api.main import app

pytestmark = pytest.mark.integration
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


@asynccontextmanager
async def request_client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.mark.anyio
@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
async def test_ready_succeeds_against_postgresql() -> None:
    async with request_client() as client:
        response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
