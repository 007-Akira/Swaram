from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from swaram_api.cleanup import cleanup_expired_sessions
from swaram_api.database import Base
from swaram_api.models import PracticeSession


class RecordingStorage:
    def __init__(self, failing: set[UUID] | None = None) -> None:
        self.deleted: list[UUID] = []
        self.failing = failing or set()

    def delete_session(self, session_id: UUID) -> bool:
        if session_id in self.failing:
            raise OSError("simulated storage failure")
        self.deleted.append(session_id)
        return True


def database() -> Session:
    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return Session(engine, expire_on_commit=False)


def add_session(db: Session, expires_at: datetime) -> PracticeSession:
    practice_session = PracticeSession(owner_token_hash="a" * 64, expires_at=expires_at)
    db.add(practice_session)
    db.commit()
    db.refresh(practice_session)
    return practice_session


def test_dry_run_is_content_free_and_does_not_mutate() -> None:
    db = database()
    expired = add_session(db, datetime.now(UTC) - timedelta(minutes=1))
    storage = RecordingStorage()
    events: list[tuple[str, dict[str, object]]] = []

    result = cleanup_expired_sessions(
        db,
        storage,  # type: ignore[arg-type]
        now=datetime.now(UTC),
        dry_run=True,
        emit=lambda event, **fields: events.append((event, fields)),
    )
    assert result.examined == 1
    assert result.deleted == 0
    assert db.get(PracticeSession, expired.id) is not None
    assert storage.deleted == []
    serialized = str(events)
    assert "owner_token_hash" not in serialized
    assert "lyrics" not in serialized
    db.close()


def test_partial_failure_is_retried_without_blocking_other_sessions() -> None:
    db = database()
    now = datetime.now(UTC)
    failing_session = add_session(db, now - timedelta(hours=2))
    successful_session = add_session(db, now - timedelta(hours=1))
    storage = RecordingStorage({failing_session.id})

    first = cleanup_expired_sessions(
        db,
        storage,
        now=now,
        dry_run=False,  # type: ignore[arg-type]
    )
    assert first == first.__class__(examined=2, deleted=1, failed=1, dry_run=False)
    remaining_ids = set(db.scalars(select(PracticeSession.id)).all())
    assert remaining_ids == {failing_session.id}
    assert storage.deleted == [successful_session.id]

    storage.failing.clear()
    second = cleanup_expired_sessions(
        db,
        storage,
        now=now,
        dry_run=False,  # type: ignore[arg-type]
    )
    assert second.deleted == 1
    assert db.scalar(select(PracticeSession.id)) is None
    db.close()


def test_unexpired_session_is_preserved() -> None:
    db = database()
    active = add_session(db, datetime.now(UTC) + timedelta(hours=1))
    result = cleanup_expired_sessions(
        db,
        RecordingStorage(),
        now=datetime.now(UTC),
        dry_run=False,  # type: ignore[arg-type]
    )
    assert result.examined == 0
    assert db.get(PracticeSession, active.id) is not None
    db.close()
