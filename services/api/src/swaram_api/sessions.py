from __future__ import annotations

import hashlib
import secrets
import tempfile
import unicodedata
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from swaram_api.audio_validation import AudioValidationError, inspect_audio
from swaram_api.database import get_db_session
from swaram_api.errors import ApiError, ErrorResponse
from swaram_api.models import AssetKind, LyricDocument, LyricLine, PracticeSession, UploadedAsset
from swaram_api.settings import get_settings
from swaram_api.storage import (
    ByteRange,
    LocalPrivateStorage,
    ObjectNotFoundError,
    PrivateStorage,
    iter_object_range,
    parse_range_header,
)

router = APIRouter(prefix="/api/v1")


class SessionCreated(BaseModel):
    id: uuid.UUID
    access_token: str
    expires_at: datetime


class AssetSummary(BaseModel):
    id: uuid.UUID
    kind: AssetKind
    media_type: str
    size_bytes: int
    duration_ms: int | None


class SessionSummary(BaseModel):
    id: uuid.UUID
    expires_at: datetime
    assets: list[AssetSummary]
    lyrics_document_id: uuid.UUID | None


class LyricsAccepted(BaseModel):
    document_id: uuid.UUID
    line_count: int


class DeletedResponse(BaseModel):
    deleted: bool


@lru_cache
def _cached_storage() -> LocalPrivateStorage:
    return LocalPrivateStorage(get_settings().private_data_root / "private")


async def get_storage() -> LocalPrivateStorage:
    return _cached_storage()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def require_session(
    session_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db_session)],
    session_token: Annotated[str | None, Header(alias="X-Session-Token")] = None,
) -> PracticeSession:
    if not session_token:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "session_token_required", "Session token required"
        )
    practice_session = db.scalar(
        select(PracticeSession)
        .where(PracticeSession.id == session_id)
        .options(
            selectinload(PracticeSession.assets),
            selectinload(PracticeSession.lyric_documents),
        )
    )
    supplied_hash = token_hash(session_token)
    if practice_session is None or not secrets.compare_digest(
        practice_session.owner_token_hash, supplied_hash
    ):
        raise ApiError(status.HTTP_404_NOT_FOUND, "session_not_found", "Session not found")
    return practice_session


@router.post(
    "/sessions",
    response_model=SessionCreated,
    status_code=status.HTTP_201_CREATED,
    responses={422: {"model": ErrorResponse}},
)
async def create_session(db: Annotated[Session, Depends(get_db_session)]) -> SessionCreated:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(hours=settings.session_retention_hours)
    practice_session = PracticeSession(owner_token_hash=token_hash(token), expires_at=expires_at)
    db.add(practice_session)
    db.commit()
    db.refresh(practice_session)
    return SessionCreated(id=practice_session.id, access_token=token, expires_at=expires_at)


def _copy_bounded(upload: UploadFile, target: Path, maximum: int) -> int:
    total = 0
    with target.open("wb") as destination:
        while chunk := upload.file.read(64 * 1024):
            total += len(chunk)
            if total > maximum:
                raise ApiError(
                    status.HTTP_413_CONTENT_TOO_LARGE,
                    "upload_too_large",
                    "Upload exceeds the configured size limit",
                )
            destination.write(chunk)
    if total == 0:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "empty_upload", "Upload is empty")
    return total


@router.post(
    "/sessions/{session_id}/audio",
    response_model=AssetSummary,
    status_code=status.HTTP_201_CREATED,
)
async def upload_audio(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
    storage: Annotated[PrivateStorage, Depends(get_storage)],
    audio: Annotated[UploadFile, File()],
) -> AssetSummary:
    settings = get_settings()
    with tempfile.TemporaryDirectory(prefix="swaram-validate-") as directory:
        temporary_path = Path(directory) / "upload"
        _copy_bounded(audio, temporary_path, settings.upload_max_bytes)
        try:
            metadata = inspect_audio(
                temporary_path, settings.ffprobe_binary, settings.audio_max_duration_seconds
            )
        except AudioValidationError as error:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_audio", str(error)
            ) from error
        with temporary_path.open("rb") as source:
            stored = storage.store(practice_session.id, source)
    asset = UploadedAsset(
        session_id=practice_session.id,
        kind=AssetKind.ORIGINAL_AUDIO,
        object_key=stored.object_key,
        original_filename=Path(audio.filename or "audio").name,
        media_type=metadata.media_type,
        size_bytes=stored.size_bytes,
        checksum_sha256=stored.checksum_sha256,
        duration_ms=metadata.duration_ms,
        expires_at=practice_session.expires_at,
    )
    try:
        db.add(asset)
        db.commit()
        db.refresh(asset)
    except BaseException:
        storage.delete(practice_session.id, stored.object_key)
        raise
    return AssetSummary.model_validate(asset, from_attributes=True)


def _lyrics_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


async def _stream_range(
    storage: PrivateStorage,
    session_id: uuid.UUID,
    object_key: str,
    byte_range: ByteRange,
) -> AsyncIterator[bytes]:
    for chunk in iter_object_range(storage, session_id, object_key, byte_range):
        yield chunk


@router.post(
    "/sessions/{session_id}/lyrics",
    response_model=LyricsAccepted,
    status_code=status.HTTP_201_CREATED,
)
async def upload_lyrics(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
    text: Annotated[str | None, Form()] = None,
    lyrics: Annotated[UploadFile | None, File()] = None,
) -> LyricsAccepted:
    if (text is None) == (lyrics is None):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "lyrics_source_required",
            "Provide either pasted text or one lyrics file",
        )
    source_format = "txt"
    if lyrics is not None:
        suffix = Path(lyrics.filename or "").suffix.lower().removeprefix(".")
        if suffix not in {"txt", "lrc", "srt"}:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "invalid_lyrics_format",
                "Lyrics file must be TXT, LRC, or SRT",
            )
        raw = lyrics.file.read(get_settings().upload_max_bytes + 1)
        if len(raw) > get_settings().upload_max_bytes:
            raise ApiError(
                status.HTTP_413_CONTENT_TOO_LARGE,
                "upload_too_large",
                "Lyrics file is too large",
            )
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "invalid_utf8",
                "Lyrics must be valid UTF-8",
            ) from error
        source_format = suffix
    normalized = unicodedata.normalize("NFC", text or "").strip()
    lines = _lyrics_lines(normalized)
    if not lines:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "empty_lyrics", "Lyrics are empty")
    document = LyricDocument(
        session_id=practice_session.id,
        text_nfc=normalized,
        source_format=source_format,
        expires_at=practice_session.expires_at,
        lines=[LyricLine(position=index, text_nfc=line) for index, line in enumerate(lines)],
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return LyricsAccepted(document_id=document.id, line_count=len(lines))


@router.get("/sessions/{session_id}", response_model=SessionSummary)
async def get_session(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
) -> SessionSummary:
    return SessionSummary(
        id=practice_session.id,
        expires_at=practice_session.expires_at,
        assets=[
            AssetSummary.model_validate(asset, from_attributes=True)
            for asset in practice_session.assets
        ],
        lyrics_document_id=(
            practice_session.lyric_documents[-1].id if practice_session.lyric_documents else None
        ),
    )


@router.get("/sessions/{session_id}/assets/{asset_id}/playback")
async def playback_asset(
    request: Request,
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    storage: Annotated[PrivateStorage, Depends(get_storage)],
    asset_id: uuid.UUID,
) -> Response:
    asset = next((item for item in practice_session.assets if item.id == asset_id), None)
    if asset is None or asset.kind not in {AssetKind.ORIGINAL_AUDIO, AssetKind.INSTRUMENTAL}:
        raise ApiError(status.HTTP_404_NOT_FOUND, "asset_not_found", "Asset not found")
    try:
        object_stat = storage.stat(practice_session.id, asset.object_key)
        byte_range = parse_range_header(request.headers.get("range"), object_stat.size_bytes)
    except ObjectNotFoundError as error:
        raise ApiError(status.HTTP_404_NOT_FOUND, "asset_not_found", "Asset not found") from error
    except ValueError:
        return Response(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{object_stat.size_bytes}"},
        )
    partial = request.headers.get("range") is not None
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(byte_range.length),
        "Cache-Control": "private, no-store",
    }
    if partial:
        headers["Content-Range"] = byte_range.content_range
    return StreamingResponse(
        _stream_range(storage, practice_session.id, asset.object_key, byte_range),
        status_code=status.HTTP_206_PARTIAL_CONTENT if partial else status.HTTP_200_OK,
        media_type=asset.media_type,
        headers=headers,
    )


@router.delete("/sessions/{session_id}", response_model=DeletedResponse)
async def delete_session(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
    storage: Annotated[PrivateStorage, Depends(get_storage)],
) -> DeletedResponse:
    storage.delete_session(practice_session.id)
    db.delete(practice_session)
    db.commit()
    return DeletedResponse(deleted=True)
