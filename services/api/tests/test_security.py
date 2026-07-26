import httpx
import pytest
from swaram_api.main import create_app
from swaram_api.settings import Settings


@pytest.mark.anyio
async def test_security_headers_and_api_no_store() -> None:
    app = create_app(Settings(_env_file=None, database_url="sqlite://"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/api/v1/sessions/not-a-uuid")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.anyio
async def test_api_rate_limit_is_bounded_per_process() -> None:
    app = create_app(
        Settings(
            _env_file=None,
            database_url="sqlite://",
            rate_limit_requests=1,
            rate_limit_window_seconds=60,
        )
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.get("/api/unknown")
        limited = await client.get("/api/unknown")
    assert first.status_code == 404
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "60"
