from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from swaram_api.database import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AssetKind(enum.StrEnum):
    ORIGINAL_AUDIO = "original_audio"
    LYRICS = "lyrics"
    NORMALIZED_AUDIO = "normalized_audio"
    VOCALS = "vocals"
    INSTRUMENTAL = "instrumental"
    ANALYSIS = "analysis"
    RECORDING = "recording"


class JobState(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


JOB_STATE_TRANSITIONS: dict[JobState, frozenset[JobState]] = {
    JobState.QUEUED: frozenset({JobState.RUNNING}),
    JobState.RUNNING: frozenset({JobState.QUEUED, JobState.SUCCEEDED, JobState.FAILED}),
    JobState.SUCCEEDED: frozenset(),
    JobState.FAILED: frozenset({JobState.QUEUED}),
}


class SystemMetadata(Base, TimestampMixin):
    __tablename__ = "system_metadata"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class PracticeSession(Base, TimestampMixin):
    __tablename__ = "practice_sessions"
    __table_args__ = (Index("ix_practice_sessions_expires_at", "expires_at"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    owner_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    assets: Mapped[list[UploadedAsset]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    lyric_documents: Mapped[list[LyricDocument]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    jobs: Mapped[list[ProcessingJob]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    analysis_packages: Mapped[list[AnalysisPackage]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    attempts: Mapped[list[PracticeAttempt]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class UploadedAsset(Base, TimestampMixin):
    __tablename__ = "uploaded_assets"
    __table_args__ = (
        UniqueConstraint("session_id", "object_key", name="uq_asset_session_object"),
        Index("ix_uploaded_assets_session_kind", "session_id", "kind"),
        Index("ix_uploaded_assets_expires_at", "expires_at"),
        CheckConstraint("size_bytes >= 0", name="ck_asset_size_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[AssetKind] = mapped_column(Enum(AssetKind, name="asset_kind"), nullable=False)
    object_key: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    session: Mapped[PracticeSession] = relationship(back_populates="assets")
    jobs: Mapped[list[ProcessingJob]] = relationship(back_populates="asset")


class ProcessingJob(Base, TimestampMixin):
    __tablename__ = "processing_jobs"
    __table_args__ = (
        UniqueConstraint("asset_id", "analysis_version", name="uq_processing_job_asset_version"),
        Index("ix_processing_jobs_queue", "state", "available_at", "created_at"),
        Index("ix_processing_jobs_lease", "state", "lease_expires_at"),
        Index("ix_processing_jobs_session", "session_id"),
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_job_progress_range"),
        CheckConstraint("attempt_count >= 0", name="ck_job_attempt_count_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("uploaded_assets.id", ondelete="CASCADE"), nullable=False
    )
    analysis_version: Mapped[str] = mapped_column(String(32), nullable=False)
    state: Mapped[JobState] = mapped_column(
        Enum(JobState, name="job_state"), nullable=False, default=JobState.QUEUED
    )
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    claimed_by: Mapped[str | None] = mapped_column(String(100))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failure_code: Mapped[str | None] = mapped_column(String(64))
    failure_detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session: Mapped[PracticeSession] = relationship(back_populates="jobs")
    asset: Mapped[UploadedAsset] = relationship(back_populates="jobs")

    def transition_to(self, new_state: JobState) -> None:
        if new_state not in JOB_STATE_TRANSITIONS[self.state]:
            raise ValueError(f"invalid job transition: {self.state.value} -> {new_state.value}")
        self.state = new_state


class LyricDocument(Base, TimestampMixin):
    __tablename__ = "lyric_documents"
    __table_args__ = (
        Index("ix_lyric_documents_session", "session_id"),
        Index("ix_lyric_documents_expires_at", "expires_at"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False
    )
    source_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("uploaded_assets.id", ondelete="SET NULL")
    )
    text_nfc: Mapped[str] = mapped_column(Text, nullable=False)
    source_format: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    session: Mapped[PracticeSession] = relationship(back_populates="lyric_documents")
    lines: Mapped[list[LyricLine]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="LyricLine.position"
    )


class LyricLine(Base, TimestampMixin):
    __tablename__ = "lyric_lines"
    __table_args__ = (
        UniqueConstraint("document_id", "position", name="uq_lyric_line_position"),
        CheckConstraint("position >= 0", name="ck_lyric_line_position_nonnegative"),
        CheckConstraint(
            "end_ms IS NULL OR start_ms IS NULL OR end_ms >= start_ms",
            name="ck_lyric_line_time_order",
        ),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lyric_documents.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    text_nfc: Mapped[str] = mapped_column(Text, nullable=False)
    start_ms: Mapped[int | None] = mapped_column(Integer)
    end_ms: Mapped[int | None] = mapped_column(Integer)
    document: Mapped[LyricDocument] = relationship(back_populates="lines")


class AnalysisPackage(Base, TimestampMixin):
    __tablename__ = "analysis_packages"
    __table_args__ = (
        UniqueConstraint("source_asset_id", "version", name="uq_analysis_asset_version"),
        Index("ix_analysis_packages_session", "session_id"),
        Index("ix_analysis_packages_expires_at", "expires_at"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False
    )
    source_asset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("uploaded_assets.id", ondelete="CASCADE"), nullable=False
    )
    object_key: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    session: Mapped[PracticeSession] = relationship(back_populates="analysis_packages")


class PracticeAttempt(Base, TimestampMixin):
    __tablename__ = "practice_attempts"
    __table_args__ = (
        Index("ix_practice_attempts_session_created", "session_id", "created_at"),
        Index("ix_practice_attempts_expires_at", "expires_at"),
        CheckConstraint(
            "completion_ratio IS NULL OR (completion_ratio >= 0 AND completion_ratio <= 1)",
            name="ck_attempt_completion_range",
        ),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False
    )
    analysis_package_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("analysis_packages.id", ondelete="SET NULL")
    )
    recording_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("uploaded_assets.id", ondelete="SET NULL")
    )
    score_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    completion_ratio: Mapped[float | None] = mapped_column(Float)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    session: Mapped[PracticeSession] = relationship(back_populates="attempts")
