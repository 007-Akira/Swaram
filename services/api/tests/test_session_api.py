import io
import unicodedata
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from swaram_api.audio_validation import AudioMetadata, AudioValidationError
from swaram_api.database import Base, get_db_session
from swaram_api.main import create_app
from swaram_api.models import (
    AnalysisPackage,
    JobState,
    PracticeAttempt,
    PracticeSession,
    ProcessingJob,
    UploadedAsset,
)
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
    application.state.test_session_factory = factory
    application.state.test_storage = storage
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
async def test_expired_session_is_unrecoverable_before_cleanup(
    api_client: httpx.AsyncClient,
) -> None:
    session_id, token = await create_private_session(api_client)
    application = api_client._transport.app  # type: ignore[attr-defined]
    with application.state.test_session_factory() as db:
        practice_session = db.get(PracticeSession, UUID(session_id))
        assert practice_session is not None
        practice_session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    response = await api_client.get(
        f"/api/v1/sessions/{session_id}",
        headers=auth(token),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "session_not_found"


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
        files={"audio": ("valid.mp3", io.BytesIO(b"valid audio"), "audio/mpeg")},
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
async def test_audio_upload_rejects_mime_and_extension_spoofing(
    api_client: httpx.AsyncClient, monkeypatch
) -> None:
    monkeypatch.setattr(
        "swaram_api.sessions.inspect_audio",
        lambda *_args: AudioMetadata(media_type="audio/mpeg", duration_ms=1_200),
    )
    session_id, token = await create_private_session(api_client)
    endpoint = f"/api/v1/sessions/{session_id}/audio"
    wrong_extension = await api_client.post(
        endpoint,
        headers=auth(token),
        files={"audio": ("fake.wav", b"decoded mp3", "audio/mpeg")},
    )
    wrong_mime = await api_client.post(
        endpoint,
        headers=auth(token),
        files={"audio": ("song.mp3", b"decoded mp3", "application/octet-stream")},
    )
    assert wrong_extension.status_code == 422
    assert wrong_mime.status_code == 422
    assert wrong_extension.json()["error"]["code"] == "invalid_audio"
    assert wrong_mime.json()["error"]["code"] == "invalid_audio"


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
async def test_failed_private_job_can_be_retried_through_http(
    api_client: httpx.AsyncClient, monkeypatch
) -> None:
    monkeypatch.setattr(
        "swaram_api.sessions.inspect_audio",
        lambda *_args: AudioMetadata(media_type="audio/wav", duration_ms=100),
    )
    session_id, token = await create_private_session(api_client)
    await api_client.post(
        f"/api/v1/sessions/{session_id}/lyrics", headers=auth(token), data={"text": "പാട്ട്"}
    )
    audio = await api_client.post(
        f"/api/v1/sessions/{session_id}/audio",
        headers=auth(token),
        files={"audio": ("audio.wav", b"content", "audio/wav")},
    )
    job_id = audio.json()["job_id"]
    application = api_client._transport.app  # type: ignore[attr-defined]
    with application.state.test_session_factory() as db:
        job = db.get(ProcessingJob, UUID(job_id))
        assert job is not None
        job.state = JobState.FAILED
        job.progress = 60
        job.progress_stage = "extracting_contour"
        job.failure_code = "audio_tool_timeout"
        db.commit()

    response = await api_client.post(f"/api/v1/jobs/{job_id}/retry", headers=auth(token))
    assert response.status_code == 200
    assert response.json()["state"] == "queued"
    assert response.json()["progress"] == 0
    assert response.json()["failure_code"] is None
    assert (
        await api_client.post(f"/api/v1/jobs/{job_id}/retry", headers=auth(token))
    ).status_code == 409


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


@pytest.mark.anyio
async def test_attempts_are_private_versioned_and_never_persist_raw_audio(
    api_client: httpx.AsyncClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "swaram_api.sessions.inspect_audio",
        lambda *_args: AudioMetadata(media_type="audio/wav", duration_ms=1_000),
    )
    session_id, token = await create_private_session(api_client)
    upload = await api_client.post(
        f"/api/v1/sessions/{session_id}/audio",
        headers=auth(token),
        files={"audio": ("test.wav", b"valid audio", "audio/wav")},
    )
    asset_id = UUID(upload.json()["id"])
    application = api_client._transport.app  # type: ignore[attr-defined]
    factory = application.state.test_session_factory
    storage = application.state.test_storage
    stored = storage.store(UUID(session_id), io.BytesIO(b"{}"))
    with factory() as db:
        practice_session = db.get(PracticeSession, UUID(session_id))
        asset = db.get(UploadedAsset, asset_id)
        assert practice_session is not None and asset is not None
        db.add(
            AnalysisPackage(
                session_id=practice_session.id,
                source_asset_id=asset.id,
                object_key=stored.object_key,
                version="1.0",
                checksum_sha256=stored.checksum_sha256,
                expires_at=practice_session.expires_at,
            )
        )
        db.commit()

    payload = {
        "analysis_version": "1.0",
        "score_version": "1.0.0",
        "tolerance_profile": "intermediate",
        "mode": "instrumental",
        "speed": 1.0,
        "latency_offset_ms": 35,
        "overall_score": 82,
        "component_scores": {
            "pitch": 80,
            "timing": 85,
            "contour": 90,
            "stability": 75,
            "completion": 80,
        },
        "evidence_confidence": 0.8,
        "valid_voiced_frames": 120,
        "phrases": [],
        "feedback": [],
    }
    endpoint = f"/api/v1/sessions/{session_id}/attempts"
    assert (await api_client.post(endpoint, json=payload)).status_code == 401
    created = await api_client.post(endpoint, headers=auth(token), json=payload)
    assert created.status_code == 201
    attempt_id = created.json()["id"]
    listed = await api_client.get(endpoint, headers=auth(token))
    assert listed.status_code == 200
    assert listed.json()["attempts"][0]["id"] == attempt_id
    detail = await api_client.get(
        f"{endpoint}/{attempt_id}",
        headers=auth(token),
    )
    assert detail.json()["data"]["score_version"] == "1.0.0"

    rejected = await api_client.post(
        endpoint,
        headers=auth(token),
        json={**payload, "raw_microphone_audio": "forbidden"},
    )
    assert rejected.status_code == 422
    with factory() as db:
        attempt = db.get(PracticeAttempt, UUID(attempt_id))
        assert attempt is not None
        assert attempt.recording_asset_id is None
        assert "raw_microphone_audio" not in (attempt.score_data or {})
