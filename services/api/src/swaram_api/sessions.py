from __future__ import annotations

import hashlib
import hmac
import json
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
from swaram_contracts import AnalysisPackageV1

from swaram_api.audio_validation import (
    AudioValidationError,
    inspect_audio,
    validate_upload_identity,
)
from swaram_api.database import get_db_session
from swaram_api.errors import ApiError, ErrorResponse
from swaram_api.lyric_parser import LyricParseError, decode_lyrics, parse_lyrics
from swaram_api.models import (
    AnalysisPackage,
    AssetKind,
    LyricDocument,
    LyricLine,
    PracticeSession,
    ProcessingJob,
    UploadedAsset,
)
from swaram_api.readiness import evaluate_readiness
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
    job_id: uuid.UUID | None = None


class SessionSummary(BaseModel):
    id: uuid.UUID
    expires_at: datetime
    assets: list[AssetSummary]
    lyrics_document_id: uuid.UUID | None


class LyricsAccepted(BaseModel):
    document_id: uuid.UUID
    line_count: int
    job_id: uuid.UUID | None = None


class EditableLyricLine(BaseModel):
    id: uuid.UUID | None = None
    text: str
    start_ms: int | None = None
    end_ms: int | None = None
    is_stanza_break: bool = False


class LyricDocumentResponse(BaseModel):
    document_id: uuid.UUID
    lines: list[EditableLyricLine]


class LyricDocumentUpdate(BaseModel):
    lines: list[EditableLyricLine]


class DeletedResponse(BaseModel):
    deleted: bool


class PlaybackUrlResponse(BaseModel):
    url: str
    expires_at: datetime


class ReadinessIssueResponse(BaseModel):
    code: str
    message: str
    action: str


class ReadinessResponse(BaseModel):
    ready: bool
    issues: list[ReadinessIssueResponse]


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
    if (
        practice_session is None
        or _utc_datetime(practice_session.expires_at) <= datetime.now(UTC)
        or not secrets.compare_digest(practice_session.owner_token_hash, supplied_hash)
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


def _safe_filename(value: str | None) -> str:
    basename = Path(value or "audio").name
    cleaned = "".join(character for character in basename if character.isprintable())
    return unicodedata.normalize("NFC", cleaned)[:255] or "audio"


@router.post(
    "/sessions/{session_id}/audio",
    response_model=AssetSummary,
    status_code=status.HTTP_201_CREATED,
)
async def upload_audio(
    response: Response,
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
    storage: Annotated[PrivateStorage, Depends(get_storage)],
    audio: Annotated[UploadFile, File()],
) -> AssetSummary:
    settings = get_settings()
    existing_assets = sum(
        asset.kind == AssetKind.ORIGINAL_AUDIO for asset in practice_session.assets
    )
    if existing_assets >= settings.max_audio_assets_per_session:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "audio_asset_limit_reached",
            "This session has reached its audio upload limit",
        )
    safe_filename = _safe_filename(audio.filename)
    with tempfile.TemporaryDirectory(prefix="swaram-validate-") as directory:
        temporary_path = Path(directory) / "upload"
        _copy_bounded(audio, temporary_path, settings.upload_max_bytes)
        try:
            metadata = inspect_audio(temporary_path)
            validate_upload_identity(
                safe_filename,
                audio.content_type or "",
                metadata.media_type,
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
        original_filename=safe_filename,
        media_type=metadata.media_type,
        size_bytes=stored.size_bytes,
        checksum_sha256=stored.checksum_sha256,
        duration_ms=metadata.duration_ms,
        expires_at=practice_session.expires_at,
    )
    try:
        db.add(asset)
        db.flush()
        job: ProcessingJob | None = None
        lyric_exists = db.scalar(
            select(LyricDocument.id).where(LyricDocument.session_id == practice_session.id).limit(1)
        )
        if lyric_exists is not None:
            from swaram_api.jobs import ensure_processing_job

            job = ensure_processing_job(db, practice_session.id, asset.id)
        db.commit()
        db.refresh(asset)
    except BaseException:
        storage.delete(practice_session.id, stored.object_key)
        raise
    if job is not None:
        response.status_code = status.HTTP_202_ACCEPTED
    summary = AssetSummary.model_validate(asset, from_attributes=True)
    return summary.model_copy(update={"job_id": job.id if job else None})


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
    response: Response,
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
            text = decode_lyrics(raw)
        except LyricParseError as error:
            raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, error.code, str(error)) from error
        source_format = suffix
    normalized = unicodedata.normalize("NFC", text or "").strip()
    try:
        lines = parse_lyrics(normalized, source_format)  # type: ignore[arg-type]
    except LyricParseError as error:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, error.code, str(error)) from error
    document = LyricDocument(
        session_id=practice_session.id,
        text_nfc=normalized,
        source_format=source_format,
        expires_at=practice_session.expires_at,
        lines=[
            LyricLine(
                position=index,
                text_nfc=line.text_nfc,
                start_ms=line.start_ms,
                end_ms=line.end_ms,
                is_stanza_break=line.is_stanza_break,
            )
            for index, line in enumerate(lines)
        ],
    )
    db.add(document)
    db.flush()
    audio_asset = db.scalar(
        select(UploadedAsset)
        .where(
            UploadedAsset.session_id == practice_session.id,
            UploadedAsset.kind == AssetKind.ORIGINAL_AUDIO,
        )
        .order_by(UploadedAsset.created_at.desc())
        .limit(1)
    )
    job: ProcessingJob | None = None
    if audio_asset is not None:
        from swaram_api.jobs import ensure_processing_job

        job = ensure_processing_job(db, practice_session.id, audio_asset.id)
    db.commit()
    db.refresh(document)
    if job is not None:
        response.status_code = status.HTTP_202_ACCEPTED
    return LyricsAccepted(
        document_id=document.id, line_count=len(lines), job_id=job.id if job else None
    )


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


def _latest_lyric_document(db: Session, practice_session: PracticeSession) -> LyricDocument:
    document = db.scalar(
        select(LyricDocument)
        .where(LyricDocument.session_id == practice_session.id)
        .options(selectinload(LyricDocument.lines))
        .order_by(LyricDocument.created_at.desc())
        .limit(1)
    )
    if document is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "lyrics_not_found", "Lyrics not found")
    return document


@router.get(
    "/sessions/{session_id}/lyrics",
    response_model=LyricDocumentResponse,
)
async def get_lyrics(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
) -> LyricDocumentResponse:
    document = _latest_lyric_document(db, practice_session)
    return LyricDocumentResponse(
        document_id=document.id,
        lines=[
            EditableLyricLine(
                id=line.id,
                text=line.text_nfc,
                start_ms=line.start_ms,
                end_ms=line.end_ms,
                is_stanza_break=line.is_stanza_break,
            )
            for line in document.lines
        ],
    )


@router.put(
    "/sessions/{session_id}/lyrics",
    response_model=LyricDocumentResponse,
)
async def update_lyrics(
    payload: LyricDocumentUpdate,
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
) -> LyricDocumentResponse:
    if not payload.lines or not any(
        line.text.strip() and not line.is_stanza_break for line in payload.lines
    ):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "empty_lyrics",
            "At least one lyric line is required",
        )
    previous_end = -1
    for line in payload.lines:
        if line.is_stanza_break:
            continue
        if not line.text.strip():
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "empty_lyric_line",
                "Lyric lines cannot be empty",
            )
        if line.start_ms is not None:
            if line.start_ms < previous_end or (
                line.end_ms is not None and line.end_ms <= line.start_ms
            ):
                raise ApiError(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "invalid_lyric_timing",
                    "Lyric timings must be ordered and non-overlapping",
                )
            previous_end = line.end_ms if line.end_ms is not None else line.start_ms
    document = _latest_lyric_document(db, practice_session)
    previous_lines = list(document.lines)
    document.lines.clear()
    for previous_line in previous_lines:
        db.delete(previous_line)
    db.flush()
    normalized_lines = [
        LyricLine(
            position=index,
            text_nfc=unicodedata.normalize("NFC", line.text),
            start_ms=line.start_ms,
            end_ms=line.end_ms,
            is_stanza_break=line.is_stanza_break,
        )
        for index, line in enumerate(payload.lines)
    ]
    document.lines.extend(normalized_lines)
    document.text_nfc = "\n".join(line.text_nfc for line in normalized_lines)
    db.commit()
    db.refresh(document)
    return LyricDocumentResponse(
        document_id=document.id,
        lines=[
            EditableLyricLine(
                id=line.id,
                text=line.text_nfc,
                start_ms=line.start_ms,
                end_ms=line.end_ms,
                is_stanza_break=line.is_stanza_break,
            )
            for line in document.lines
        ],
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
    return _playback_response(request, practice_session, storage, asset)


def _playback_response(
    request: Request,
    practice_session: PracticeSession,
    storage: PrivateStorage,
    asset: UploadedAsset,
) -> Response:
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


def _playback_signature(
    practice_session: PracticeSession,
    asset_id: uuid.UUID,
    expires: int,
) -> str:
    message = f"{practice_session.id}:{asset_id}:{expires}".encode()
    return hmac.new(
        practice_session.owner_token_hash.encode(),
        message,
        hashlib.sha256,
    ).hexdigest()


def _utc_datetime(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


@router.get(
    "/sessions/{session_id}/assets/{asset_id}/playback-url",
    response_model=PlaybackUrlResponse,
)
async def playback_url(
    request: Request,
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    asset_id: uuid.UUID,
) -> PlaybackUrlResponse:
    asset = next((item for item in practice_session.assets if item.id == asset_id), None)
    if asset is None or asset.kind not in {AssetKind.ORIGINAL_AUDIO, AssetKind.INSTRUMENTAL}:
        raise ApiError(status.HTTP_404_NOT_FOUND, "asset_not_found", "Asset not found")
    expires_at = min(
        _utc_datetime(practice_session.expires_at),
        datetime.now(UTC) + timedelta(minutes=5),
    )
    expires = int(expires_at.timestamp())
    signature = _playback_signature(practice_session, asset.id, expires)
    url = request.url_for(
        "signed_playback_asset",
        session_id=str(practice_session.id),
        asset_id=str(asset.id),
    )
    return PlaybackUrlResponse(
        url=f"{url}?expires={expires}&signature={signature}",
        expires_at=expires_at,
    )


@router.get(
    "/sessions/{session_id}/assets/{asset_id}/signed-playback",
    name="signed_playback_asset",
)
async def signed_playback_asset(
    request: Request,
    db: Annotated[Session, Depends(get_db_session)],
    storage: Annotated[PrivateStorage, Depends(get_storage)],
    session_id: uuid.UUID,
    asset_id: uuid.UUID,
    expires: int,
    signature: str,
) -> Response:
    practice_session = db.scalar(
        select(PracticeSession)
        .where(PracticeSession.id == session_id)
        .options(selectinload(PracticeSession.assets))
    )
    now = datetime.now(UTC)
    if (
        practice_session is None
        or expires < int(now.timestamp())
        or expires > int(_utc_datetime(practice_session.expires_at).timestamp())
        or not secrets.compare_digest(
            signature,
            _playback_signature(practice_session, asset_id, expires),
        )
    ):
        raise ApiError(status.HTTP_404_NOT_FOUND, "asset_not_found", "Asset not found")
    asset = next((item for item in practice_session.assets if item.id == asset_id), None)
    if asset is None or asset.kind not in {AssetKind.ORIGINAL_AUDIO, AssetKind.INSTRUMENTAL}:
        raise ApiError(status.HTTP_404_NOT_FOUND, "asset_not_found", "Asset not found")
    return _playback_response(request, practice_session, storage, asset)


@router.get(
    "/sessions/{session_id}/analysis",
    response_model=AnalysisPackageV1,
)
async def session_analysis(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
    storage: Annotated[PrivateStorage, Depends(get_storage)],
) -> AnalysisPackageV1:
    package = db.scalar(
        select(AnalysisPackage)
        .where(AnalysisPackage.session_id == practice_session.id)
        .order_by(AnalysisPackage.created_at.desc())
        .limit(1)
    )
    if package is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "analysis_not_found",
            "Analysis is not available",
        )
    try:
        with storage.open(practice_session.id, package.object_key) as source:
            payload = json.load(source)
        return AnalysisPackageV1.model_validate(payload)
    except ObjectNotFoundError as error:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "analysis_not_found",
            "Analysis is not available",
        ) from error
    except (json.JSONDecodeError, ValueError) as error:
        raise ApiError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "analysis_invalid",
            "Stored analysis is invalid",
        ) from error


@router.get(
    "/sessions/{session_id}/readiness",
    response_model=ReadinessResponse,
)
async def session_readiness(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
    storage: Annotated[PrivateStorage, Depends(get_storage)],
) -> ReadinessResponse:
    issues = evaluate_readiness(db, practice_session, storage)
    return ReadinessResponse(
        ready=not issues,
        issues=[
            ReadinessIssueResponse(code=issue.code, message=issue.message, action=issue.action)
            for issue in issues
        ],
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
