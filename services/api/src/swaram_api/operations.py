from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from swaram_api.database import get_db_session
from swaram_api.errors import ApiError
from swaram_api.models import JobState, PracticeSession, ProcessingJob

router = APIRouter(prefix="/ops")


class OperationalMetrics(BaseModel):
    jobs: dict[str, int]
    expired_sessions_pending_cleanup: int


async def require_operations_token(
    request: Request,
    token: Annotated[str | None, Header(alias="X-Operations-Token")] = None,
) -> None:
    configured = request.app.state.settings.operations_token
    if (
        configured is None
        or token is None
        or not secrets.compare_digest(configured.get_secret_value(), token)
    ):
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Not found")


@router.get(
    "/metrics",
    response_model=OperationalMetrics,
    dependencies=[Depends(require_operations_token)],
)
async def operational_metrics(
    db: Annotated[Session, Depends(get_db_session)],
) -> OperationalMetrics:
    rows = db.execute(
        select(ProcessingJob.state, func.count(ProcessingJob.id)).group_by(ProcessingJob.state)
    ).all()
    counts = {state.value: 0 for state in JobState}
    for state, count in rows:
        counts[state.value] = int(count)
    expired = db.scalar(
        select(func.count(PracticeSession.id)).where(
            PracticeSession.expires_at <= datetime.now(UTC)
        )
    )
    return OperationalMetrics(
        jobs=counts,
        expired_sessions_pending_cleanup=int(expired or 0),
    )
