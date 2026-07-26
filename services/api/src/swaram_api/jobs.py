from __future__ import annotations

import secrets
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from swaram_api.database import get_db_session
from swaram_api.errors import ApiError
from swaram_api.models import JobState, PracticeSession, ProcessingJob
from swaram_api.sessions import token_hash

router = APIRouter(prefix="/api/v1")
CURRENT_ANALYSIS_VERSION = "1.0"


class JobStatus(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    asset_id: uuid.UUID
    analysis_version: str
    state: JobState
    progress: int
    progress_stage: str
    attempt_count: int
    failure_code: str | None
    created_at: datetime
    updated_at: datetime


def ensure_processing_job(db: Session, session_id: uuid.UUID, asset_id: uuid.UUID) -> ProcessingJob:
    existing = db.scalar(
        select(ProcessingJob).where(
            ProcessingJob.asset_id == asset_id,
            ProcessingJob.analysis_version == CURRENT_ANALYSIS_VERSION,
        )
    )
    if existing is not None:
        return existing
    job = ProcessingJob(
        session_id=session_id,
        asset_id=asset_id,
        analysis_version=CURRENT_ANALYSIS_VERSION,
        state=JobState.QUEUED,
    )
    db.add(job)
    db.flush()
    return job


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job(
    job_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db_session)],
    session_token: Annotated[str | None, Header(alias="X-Session-Token")] = None,
) -> JobStatus:
    if not session_token:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "session_token_required", "Session token required"
        )
    job = db.scalar(
        select(ProcessingJob)
        .where(ProcessingJob.id == job_id)
        .options(joinedload(ProcessingJob.session))
    )
    supplied_hash = token_hash(session_token)
    if (
        job is None
        or not isinstance(job.session, PracticeSession)
        or not secrets.compare_digest(job.session.owner_token_hash, supplied_hash)
    ):
        raise ApiError(status.HTTP_404_NOT_FOUND, "job_not_found", "Job not found")
    return JobStatus.model_validate(job, from_attributes=True)
