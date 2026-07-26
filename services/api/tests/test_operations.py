import httpx
import pytest
from swaram_api.main import create_app
from swaram_api.settings import Settings


@pytest.mark.anyio
async def test_operational_metrics_hide_their_existence_without_token() -> None:
    app = create_app(
        Settings(
            _env_file=None,
            database_url="sqlite://",
            operations_token="o" * 32,
        )
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        missing = await client.get("/ops/metrics")
        wrong = await client.get(
            "/ops/metrics",
            headers={"X-Operations-Token": "wrong"},
        )
    assert missing.status_code == 404
    assert wrong.status_code == 404


@pytest.mark.anyio
async def test_request_ids_are_bounded_and_returned() -> None:
    app = create_app(Settings(_env_file=None, database_url="sqlite://"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        supplied = await client.get("/health", headers={"X-Request-ID": "monitor-123"})
        replaced = await client.get("/health", headers={"X-Request-ID": "x" * 200})
    assert supplied.headers["x-request-id"] == "monitor-123"
    assert len(replaced.headers["x-request-id"]) == 32
