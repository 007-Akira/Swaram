from __future__ import annotations

import argparse
import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from swaram_api.database import get_session_factory
from swaram_api.models import PracticeSession
from swaram_api.settings import get_settings
from swaram_api.storage import LocalPrivateStorage, PrivateStorage

logger = logging.getLogger("swaram.retention")


@dataclass(frozen=True)
class CleanupResult:
    examined: int
    deleted: int
    failed: int
    dry_run: bool


def audit(event: str, **fields: Any) -> None:
    logger.info(json.dumps({"event": event, **fields}, sort_keys=True, default=str))


def cleanup_expired_sessions(
    db: Session,
    storage: PrivateStorage,
    *,
    now: datetime,
    dry_run: bool,
    emit: Callable[..., None] = audit,
) -> CleanupResult:
    expired = db.scalars(
        select(PracticeSession)
        .where(PracticeSession.expires_at <= now)
        .order_by(PracticeSession.expires_at)
    ).all()
    deleted = 0
    failed = 0
    for practice_session in expired:
        safe_fields = {
            "session_id": str(practice_session.id),
            "expired_at": practice_session.expires_at.isoformat(),
        }
        if dry_run:
            emit("retention_delete_planned", **safe_fields)
            continue
        try:
            storage.delete_session(practice_session.id)
            db.delete(practice_session)
            db.commit()
        except Exception as error:
            db.rollback()
            failed += 1
            emit(
                "retention_delete_failed",
                **safe_fields,
                error_type=type(error).__name__,
            )
            continue
        deleted += 1
        emit("retention_deleted", **safe_fields)
    result = CleanupResult(examined=len(expired), deleted=deleted, failed=failed, dry_run=dry_run)
    emit("retention_complete", **asdict(result))
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Delete expired private Swaram sessions")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report expired session IDs without deleting database rows or objects",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    storage = LocalPrivateStorage(settings.private_data_root / "private")
    with get_session_factory()() as db:
        result = cleanup_expired_sessions(db, storage, now=datetime.now(UTC), dry_run=args.dry_run)
    if result.failed:
        raise SystemExit(1)
