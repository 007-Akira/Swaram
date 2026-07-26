import unicodedata
from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

ANALYSIS_VERSION = "1.0"
NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Confidence = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
NonNegativeFloat = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PracticeSession(ContractModel):
    id: UUID
    owner_id: UUID
    title: Annotated[NonEmptyText, Field(max_length=200)]
    created_at: AwareDatetime
    expires_at: AwareDatetime

    @model_validator(mode="after")
    def expiry_follows_creation(self) -> "PracticeSession":
        if self.expires_at <= self.created_at:
            raise ValueError("expires_at must be later than created_at")
        return self


class AssetKind(StrEnum):
    AUDIO = "audio"
    LYRICS = "lyrics"


class UploadedAsset(ContractModel):
    id: UUID
    session_id: UUID
    kind: AssetKind
    filename: Annotated[NonEmptyText, Field(max_length=255)]
    content_type: NonEmptyText
    size_bytes: Annotated[int, Field(ge=0)]
    created_at: AwareDatetime


class JobState(StrEnum):
    QUEUED = "queued"
    CLAIMED = "claimed"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


_JOB_TRANSITIONS: dict[JobState, frozenset[JobState]] = {
    JobState.QUEUED: frozenset({JobState.CLAIMED, JobState.CANCELLED}),
    JobState.CLAIMED: frozenset(
        {JobState.QUEUED, JobState.RUNNING, JobState.FAILED, JobState.CANCELLED}
    ),
    JobState.RUNNING: frozenset(
        {JobState.QUEUED, JobState.SUCCEEDED, JobState.FAILED, JobState.CANCELLED}
    ),
    JobState.SUCCEEDED: frozenset(),
    JobState.FAILED: frozenset({JobState.QUEUED}),
    JobState.CANCELLED: frozenset(),
}


def is_valid_job_transition(previous: JobState, next_state: JobState) -> bool:
    return next_state in _JOB_TRANSITIONS[previous]


class ProcessingJob(ContractModel):
    id: UUID
    session_id: UUID
    state: JobState
    attempts: Annotated[int, Field(ge=0)]
    created_at: AwareDatetime
    updated_at: AwareDatetime
    error_code: str | None = None


class TimedRange(ContractModel):
    start_seconds: NonNegativeFloat
    end_seconds: NonNegativeFloat

    @model_validator(mode="after")
    def end_follows_start(self) -> "TimedRange":
        if self.end_seconds <= self.start_seconds:
            raise ValueError("end_seconds must be greater than start_seconds")
        return self


class LyricLine(TimedRange):
    id: UUID
    text: Annotated[str, Field(min_length=1)]

    @field_validator("text")
    @classmethod
    def normalize_malayalam_text(cls, value: str) -> str:
        return unicodedata.normalize("NFC", value)


class PitchFrame(ContractModel):
    time_ms: Annotated[int, Field(ge=0)]
    frequency_hz: Annotated[float, Field(gt=0, allow_inf_nan=False)] | None
    midi: Annotated[float, Field(allow_inf_nan=False)] | None
    confidence: Confidence
    voiced: bool

    @model_validator(mode="after")
    def voiced_values_are_consistent(self) -> "PitchFrame":
        has_pitch = self.frequency_hz is not None and self.midi is not None
        if self.voiced != has_pitch:
            raise ValueError(
                "voiced frames require frequency_hz and midi; unvoiced frames require nulls"
            )
        return self


class SongSection(TimedRange):
    id: UUID
    label: Annotated[NonEmptyText, Field(max_length=100)]


class PitchRangeMetadata(ContractModel):
    minimum_frequency_hz: Annotated[float, Field(gt=0, allow_inf_nan=False)] | None = None
    maximum_frequency_hz: Annotated[float, Field(gt=0, allow_inf_nan=False)] | None = None

    @model_validator(mode="after")
    def range_is_ordered(self) -> "PitchRangeMetadata":
        if (
            self.minimum_frequency_hz is not None
            and self.maximum_frequency_hz is not None
            and self.maximum_frequency_hz < self.minimum_frequency_hz
        ):
            raise ValueError("maximum_frequency_hz must not be below minimum_frequency_hz")
        return self


class EnergyPoint(ContractModel):
    time_ms: Annotated[int, Field(ge=0)]
    rms: NonNegativeFloat


class AnalysisPackageV1(ContractModel):
    analysis_version: Literal["1.0"] = "1.0"
    session_id: UUID
    generated_at: AwareDatetime
    duration_seconds: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    pitch_frames: list[PitchFrame]
    raw_pitch_frames: list[PitchFrame] = Field(default_factory=list, exclude=True)
    input_checksum_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")] = "0" * 64
    pipeline_version: NonEmptyText = ANALYSIS_VERSION
    model_identifier: NonEmptyText = "none"
    pitch_range: PitchRangeMetadata = Field(default_factory=PitchRangeMetadata)
    voiced_coverage: Confidence = 0
    estimated_tempo_bpm: Annotated[float, Field(gt=0, allow_inf_nan=False)] | None = None
    tempo_confidence: Confidence = 0
    tempo_limitation: NonEmptyText = "Tempo metadata is unavailable."
    beat_timestamps_ms: list[Annotated[int, Field(ge=0)]] = Field(default_factory=list)
    energy_envelope: list[EnergyPoint] = Field(default_factory=list)
    sections: list[SongSection]


class PracticeAttemptSummary(ContractModel):
    id: UUID
    session_id: UUID
    completed_at: AwareDatetime
    pitch_score: Confidence
    timing_score: Confidence
    contour_score: Confidence
    stability_score: Confidence
    completion_score: Confidence
    valid_voiced_frames: Annotated[int, Field(ge=0)]


class ApiError(ContractModel):
    code: NonEmptyText
    message: NonEmptyText
    request_id: NonEmptyText
    details: dict[str, Any] | None = None


class ApiErrorEnvelope(ContractModel):
    error: ApiError
