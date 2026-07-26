from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from swaram_api.database import get_db_session
from swaram_api.main import app


@asynccontextmanager
async def request_client() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.mark.anyio
async def test_health_uses_http_and_has_no_dependencies() -> None:
    async with request_client() as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_ready_returns_success_when_database_responds() -> None:
    session = Mock(spec=Session)

    async def override_session() -> Session:
        return session

    app.dependency_overrides[get_db_session] = override_session
    try:
        async with request_client() as client:
            response = await client.get("/ready")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    session.execute.assert_called_once()


@pytest.mark.anyio
async def test_ready_returns_clear_unavailable_response() -> None:
    session = Mock(spec=Session)
    session.execute.side_effect = OperationalError("SELECT 1", {}, Exception("offline"))

    async def override_session() -> Session:
        return session

    app.dependency_overrides[get_db_session] = override_session
    try:
        async with request_client() as client:
            response = await client.get("/ready")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "database_unavailable",
            "message": "PostgreSQL readiness check failed",
        }
    }
