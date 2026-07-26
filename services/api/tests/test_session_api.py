import io
import unicodedata
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from swaram_api.audio_validation import AudioMetadata, AudioValidationError
from swaram_api.database import Base, get_db_session
from swaram_api.main import create_app
from swaram_api.sessions import get_storage
from swaram_api.settings import Settings
from swaram_api.storage import LocalPrivateStorage


@pytest.fixture
async def api_client(tmp_path, monkeypatch) -> AsyncIterator[httpx.AsyncClient]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        private_data_root=tmp_path,
        upload_max_bytes=16,
    )
    application = create_app(settings)

    async def database_override():
        with factory() as session:
            yield session

    storage = LocalPrivateStorage(tmp_path / "objects")
    application.dependency_overrides[get_db_session] = database_override

    async def storage_override():
        return storage

    application.dependency_overrides[get_storage] = storage_override
    monkeypatch.setattr("swaram_api.sessions.get_settings", lambda: settings)
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    engine.dispose()


async def create_private_session(client: httpx.AsyncClient) -> tuple[str, str]:
    response = await client.post("/api/v1/sessions")
    assert response.status_code == 201
    payload = response.json()
    return payload["id"], payload["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


@pytest.mark.anyio
async def test_session_is_private_and_cross_session_access_is_hidden(
    api_client: httpx.AsyncClient,
) -> None:
    session_id, token = await create_private_session(api_client)
    _, other_token = await create_private_session(api_client)
    assert (await api_client.get(f"/api/v1/sessions/{session_id}")).status_code == 401
    response = await api_client.get(f"/api/v1/sessions/{session_id}", headers=auth(other_token))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "session_not_found"
    assert (
        await api_client.get(f"/api/v1/sessions/{session_id}", headers=auth(token))
    ).status_code == 200


@pytest.mark.anyio
async def test_audio_upload_validates_content_and_supports_private_ranges(
    api_client: httpx.AsyncClient, monkeypatch
) -> None:
    monkeypatch.setattr(
        "swaram_api.sessions.inspect_audio",
        lambda *_args: AudioMetadata(media_type="audio/mpeg", duration_ms=1200),
    )
    session_id, token = await create_private_session(api_client)
    response = await api_client.post(
        f"/api/v1/sessions/{session_id}/audio",
        headers=auth(token),
        files={"audio": ("misleading.wav", io.BytesIO(b"valid audio"), "application/octet-stream")},
    )
    assert response.status_code == 201
    asset_id = response.json()["id"]
    playback_url = f"/api/v1/sessions/{session_id}/assets/{asset_id}/playback"
    assert (await api_client.get(playback_url)).status_code == 401
    playback = await api_client.get(playback_url, headers={**auth(token), "Range": "bytes=2-6"})
    assert playback.status_code == 206
    assert playback.content == b"lid a"
    assert playback.headers["content-range"] == "bytes 2-6/11"
    playback_url_endpoint = f"/api/v1/sessions/{session_id}/assets/{asset_id}/playback-url"
    assert (await api_client.get(playback_url_endpoint)).status_code == 401
    signed_url_response = await api_client.get(
        playback_url_endpoint,
        headers=auth(token),
    )
    assert signed_url_response.status_code == 200
    signed_url = signed_url_response.json()["url"]
    signed_playback = await api_client.get(
        signed_url,
        headers={"Range": "bytes=0-3"},
    )
    assert signed_playback.status_code == 206
    assert signed_playback.content == b"vali"
    tampered_url = signed_url.replace("signature=", "signature=0", 1)
    assert (await api_client.get(tampered_url)).status_code == 404


@pytest.mark.anyio
async def test_invalid_and_oversized_audio_have_stable_errors(
    api_client: httpx.AsyncClient, monkeypatch
) -> None:
    session_id, token = await create_private_session(api_client)

    def reject(*_args) -> None:
        raise AudioValidationError("file is not decodable audio")

    monkeypatch.setattr("swaram_api.sessions.inspect_audio", reject)
    invalid = await api_client.post(
        f"/api/v1/sessions/{session_id}/audio",
        headers=auth(token),
        files={"audio": ("fake.mp3", b"not audio", "audio/mpeg")},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_audio"

    oversized = await api_client.post(
        f"/api/v1/sessions/{session_id}/audio",
        headers=auth(token),
        files={"audio": ("large.wav", b"x" * 17, "audio/wav")},
    )
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "upload_too_large"


@pytest.mark.anyio
async def test_lyrics_are_utf8_nfc_normalized_and_files_are_restricted(
    api_client: httpx.AsyncClient,
) -> None:
    session_id, token = await create_private_session(api_client)
    decomposed = unicodedata.normalize("NFD", "മലയാളം")
    accepted = await api_client.post(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        data={"text": f"{decomposed}\nപാട്ട്"},
    )
    assert accepted.status_code == 201
    assert accepted.json()["line_count"] == 2
    invalid = await api_client.post(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        files={"lyrics": ("lyrics.pdf", b"text", "application/pdf")},
    )
    assert invalid.status_code == 422
    bad_utf8 = await api_client.post(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        files={"lyrics": ("lyrics.txt", b"\xff", "text/plain")},
    )
    assert bad_utf8.json()["error"]["code"] == "invalid_utf8"


@pytest.mark.anyio
async def test_delete_removes_database_and_storage_idempotently(
    api_client: httpx.AsyncClient, monkeypatch
) -> None:
    monkeypatch.setattr(
        "swaram_api.sessions.inspect_audio",
        lambda *_args: AudioMetadata(media_type="audio/wav", duration_ms=100),
    )
    session_id, token = await create_private_session(api_client)
    await api_client.post(
        f"/api/v1/sessions/{session_id}/audio",
        headers=auth(token),
        files={"audio": ("audio.wav", b"content", "audio/wav")},
    )
    deleted = await api_client.delete(f"/api/v1/sessions/{session_id}", headers=auth(token))
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert (
        await api_client.get(f"/api/v1/sessions/{session_id}", headers=auth(token))
    ).status_code == 404


@pytest.mark.anyio
async def test_ready_inputs_create_one_private_idempotent_job(
    api_client: httpx.AsyncClient, monkeypatch
) -> None:
    monkeypatch.setattr(
        "swaram_api.sessions.inspect_audio",
        lambda *_args: AudioMetadata(media_type="audio/wav", duration_ms=100),
    )
    session_id, token = await create_private_session(api_client)
    lyrics = await api_client.post(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        data={"text": "പാട്ട്"},
    )
    assert lyrics.status_code == 201
    assert lyrics.json()["job_id"] is None
    audio = await api_client.post(
        f"/api/v1/sessions/{session_id}/audio",
        headers=auth(token),
        files={"audio": ("audio.wav", b"content", "audio/wav")},
    )
    assert audio.status_code == 202
    job_id = audio.json()["job_id"]
    job = await api_client.get(f"/api/v1/jobs/{job_id}", headers=auth(token))
    assert job.status_code == 200
    assert job.json()["state"] == "queued"
    assert job.json()["analysis_version"] == "1.0"
    _, other_token = await create_private_session(api_client)
    assert (
        await api_client.get(f"/api/v1/jobs/{job_id}", headers=auth(other_token))
    ).status_code == 404
    another_lyrics = await api_client.post(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        data={"text": "വീണ്ടും"},
    )
    assert another_lyrics.status_code == 202
    assert another_lyrics.json()["job_id"] == job_id


@pytest.mark.anyio
async def test_lyric_editor_round_trip_normalizes_and_validates(
    api_client: httpx.AsyncClient,
) -> None:
    session_id, token = await create_private_session(api_client)
    await api_client.post(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        data={"text": "മഴവില്ല്\n\nകൺമണി"},
    )
    loaded = await api_client.get(f"/api/v1/sessions/{session_id}/lyrics", headers=auth(token))
    assert loaded.status_code == 200
    assert loaded.json()["lines"][1]["is_stanza_break"] is True
    decomposed = unicodedata.normalize("NFD", "കൺമണി")
    updated = await api_client.put(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        json={
            "lines": [
                {
                    "text": decomposed,
                    "start_ms": 1000,
                    "end_ms": 2000,
                    "is_stanza_break": False,
                },
                {
                    "text": "",
                    "start_ms": None,
                    "end_ms": None,
                    "is_stanza_break": True,
                },
            ]
        },
    )
    assert updated.status_code == 200
    assert updated.json()["lines"][0]["text"] == unicodedata.normalize("NFC", decomposed)
    invalid = await api_client.put(
        f"/api/v1/sessions/{session_id}/lyrics",
        headers=auth(token),
        json={
            "lines": [
                {
                    "text": "തെറ്റ്",
                    "start_ms": 2000,
                    "end_ms": 1000,
                    "is_stanza_break": False,
                }
            ]
        },
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_lyric_timing"


@pytest.mark.anyio
async def test_readiness_endpoint_is_private_and_actionable(
    api_client: httpx.AsyncClient,
) -> None:
    session_id, token = await create_private_session(api_client)
    endpoint = f"/api/v1/sessions/{session_id}/readiness"
    assert (await api_client.get(endpoint)).status_code == 401
    response = await api_client.get(endpoint, headers=auth(token))
    assert response.status_code == 200
    assert response.json()["ready"] is False
    issues = response.json()["issues"]
    assert {"analysis_incomplete", "lyrics_missing", "playback_missing"} == {
        issue["code"] for issue in issues
    }
    assert all(issue["action"] for issue in issues)


@pytest.mark.anyio
async def test_analysis_endpoint_is_private_and_reports_missing(
    api_client: httpx.AsyncClient,
) -> None:
    session_id, token = await create_private_session(api_client)
    endpoint = f"/api/v1/sessions/{session_id}/analysis"
    assert (await api_client.get(endpoint)).status_code == 401
    response = await api_client.get(endpoint, headers=auth(token))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "analysis_not_found"
