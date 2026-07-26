from datetime import UTC, datetime, timedelta
from io import BytesIO

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from swaram_api.database import Base
from swaram_api.models import (
    AnalysisPackage,
    AssetKind,
    LyricDocument,
    LyricLine,
    PracticeSession,
    UploadedAsset,
)
from swaram_api.readiness import evaluate_readiness
from swaram_api.storage import LocalPrivateStorage


def ready_fixture(tmp_path):
    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    storage = LocalPrivateStorage(tmp_path)
    expiry = datetime.now(UTC) + timedelta(hours=1)
    practice_session = PracticeSession(owner_token_hash="a" * 64, expires_at=expiry)
    db.add(practice_session)
    db.flush()
    stored = storage.store(practice_session.id, BytesIO(b"private playback"))
    asset = UploadedAsset(
        session_id=practice_session.id,
        kind=AssetKind.ORIGINAL_AUDIO,
        object_key=stored.object_key,
        media_type="audio/wav",
        size_bytes=stored.size_bytes,
        checksum_sha256=stored.checksum_sha256,
        duration_ms=3000,
        expires_at=expiry,
    )
    db.add(asset)
    db.flush()
    db.add(
        AnalysisPackage(
            session_id=practice_session.id,
            source_asset_id=asset.id,
            object_key="analysis-key",
            version="1.0",
            checksum_sha256="b" * 64,
            expires_at=expiry,
        )
    )
    document = LyricDocument(
        session_id=practice_session.id,
        text_nfc="മഴവില്ല്",
        source_format="txt",
        expires_at=expiry,
        lines=[
            LyricLine(
                position=0,
                text_nfc="മഴവില്ല്",
                start_ms=0,
                end_ms=3000,
                is_stanza_break=False,
            )
        ],
    )
    db.add(document)
    db.commit()
    return db, storage, practice_session, document, asset


def test_ready_session_has_no_issues(tmp_path) -> None:
    db, storage, practice_session, _document, _asset = ready_fixture(tmp_path)
    assert evaluate_readiness(db, practice_session, storage) == []
    db.close()


def test_readiness_returns_actionable_timing_and_playback_fixes(tmp_path) -> None:
    db, storage, practice_session, document, asset = ready_fixture(tmp_path)
    document.lines[0].end_ms = None
    storage.delete(practice_session.id, asset.object_key)
    db.commit()
    issues = evaluate_readiness(db, practice_session, storage)
    assert {issue.code for issue in issues} == {"lyrics_untimed", "playback_unavailable"}
    assert all(issue.action and issue.message for issue in issues)
    db.close()
