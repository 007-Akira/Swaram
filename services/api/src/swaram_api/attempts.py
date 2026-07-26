from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from swaram_api.database import get_db_session
from swaram_api.errors import ApiError
from swaram_api.models import AnalysisPackage, PracticeAttempt, PracticeSession
from swaram_api.sessions import require_session

router = APIRouter(prefix="/api/v1")


class MetricRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: float | None = Field(default=None, ge=0, le=100)
    value: float | None = None
    confidence: float = Field(ge=0, le=1)
    coverage: float = Field(ge=0, le=1)
    sufficient: bool


class FeedbackRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=64)
    kind: Literal["strength", "correction", "insufficient"]
    message: str = Field(min_length=1, max_length=500)


class PhraseRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line_id: uuid.UUID
    text: str = Field(min_length=1, max_length=2_000)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    score: float | None = Field(default=None, ge=0, le=100)
    metrics: dict[
        Literal["pitch", "timing", "contour", "stability", "completion"],
        MetricRecord,
    ]
    feedback: list[FeedbackRecord] = Field(max_length=3)


class AttemptScoreData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_version: str = Field(min_length=1, max_length=32)
    score_version: str = Field(min_length=1, max_length=32)
    tolerance_profile: Literal["beginner", "intermediate"]
    mode: Literal["original", "instrumental", "reduced_reference"]
    speed: float
    latency_offset_ms: int = Field(ge=0, le=1_000)
    overall_score: float | None = Field(default=None, ge=0, le=100)
    component_scores: dict[
        Literal["pitch", "timing", "contour", "stability", "completion"],
        float | None,
    ]
    evidence_confidence: float = Field(ge=0, le=1)
    valid_voiced_frames: int = Field(ge=0)
    phrases: list[PhraseRecord] = Field(max_length=2_000)
    feedback: list[FeedbackRecord] = Field(max_length=5)

    @field_validator("speed")
    @classmethod
    def supported_speed(cls, value: float) -> float:
        if value not in {0.5, 0.75, 0.9, 1.0}:
            raise ValueError("unsupported practice speed")
        return value


class AttemptResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    created_at: datetime
    data: AttemptScoreData


class AttemptListResponse(BaseModel):
    attempts: list[AttemptResponse]


def _response(attempt: PracticeAttempt) -> AttemptResponse:
    return AttemptResponse(
        id=attempt.id,
        session_id=attempt.session_id,
        created_at=attempt.created_at,
        data=AttemptScoreData.model_validate(attempt.score_data),
    )


@router.post(
    "/sessions/{session_id}/attempts",
    response_model=AttemptResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_attempt(
    payload: AttemptScoreData,
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
) -> AttemptResponse:
    analysis = db.scalar(
        select(AnalysisPackage)
        .where(
            AnalysisPackage.session_id == practice_session.id,
            AnalysisPackage.version == payload.analysis_version,
        )
        .order_by(AnalysisPackage.created_at.desc())
        .limit(1)
    )
    if analysis is None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "analysis_version_unavailable",
            "The requested analysis version is unavailable",
        )
    completion = payload.component_scores.get("completion")
    attempt = PracticeAttempt(
        session_id=practice_session.id,
        analysis_package_id=analysis.id,
        recording_asset_id=None,
        score_data=payload.model_dump(mode="json"),
        completion_ratio=None if completion is None else completion / 100,
        expires_at=practice_session.expires_at,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return _response(attempt)


@router.get(
    "/sessions/{session_id}/attempts",
    response_model=AttemptListResponse,
)
async def list_attempts(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
) -> AttemptListResponse:
    attempts = db.scalars(
        select(PracticeAttempt)
        .where(PracticeAttempt.session_id == practice_session.id)
        .order_by(PracticeAttempt.created_at.desc())
        .limit(100)
    ).all()
    return AttemptListResponse(attempts=[_response(attempt) for attempt in attempts])


@router.get(
    "/sessions/{session_id}/attempts/{attempt_id}",
    response_model=AttemptResponse,
)
async def get_attempt(
    practice_session: Annotated[PracticeSession, Depends(require_session)],
    db: Annotated[Session, Depends(get_db_session)],
    attempt_id: uuid.UUID,
) -> AttemptResponse:
    attempt = db.scalar(
        select(PracticeAttempt).where(
            PracticeAttempt.id == attempt_id,
            PracticeAttempt.session_id == practice_session.id,
        )
    )
    if attempt is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "attempt_not_found",
            "Practice attempt not found",
        )
    return _response(attempt)
