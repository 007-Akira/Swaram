import unicodedata
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError
from swaram_contracts import (
    ANALYSIS_VERSION,
    JobState,
    LyricLine,
    PitchFrame,
    PracticeSession,
    is_valid_job_transition,
)


def test_analysis_version_is_one() -> None:
    assert ANALYSIS_VERSION == "1.0"


def test_rejects_malformed_timestamp() -> None:
    with pytest.raises(ValidationError):
        PracticeSession.model_validate(
            {
                "id": uuid4(),
                "owner_id": uuid4(),
                "title": "പരിശീലനം",
                "created_at": "yesterday",
                "expires_at": datetime.now(UTC) + timedelta(days=1),
            }
        )


@pytest.mark.parametrize(
    ("frequency", "confidence"),
    [(-1, 0.5), (440, -0.1), (440, 1.1)],
)
def test_rejects_invalid_pitch_values(frequency: float, confidence: float) -> None:
    with pytest.raises(ValidationError):
        PitchFrame(
            time_ms=0,
            frequency_hz=frequency,
            midi=69,
            confidence=confidence,
            voiced=True,
        )


def test_job_transition_rules() -> None:
    assert is_valid_job_transition(JobState.QUEUED, JobState.CLAIMED)
    assert is_valid_job_transition(JobState.CLAIMED, JobState.RUNNING)
    assert not is_valid_job_transition(JobState.SUCCEEDED, JobState.RUNNING)


def test_lyric_text_is_normalized_to_nfc() -> None:
    decomposed = "കൊ"
    line = LyricLine(
        id=uuid4(),
        text=decomposed,
        start_seconds=0,
        end_seconds=1,
    )
    assert line.text == unicodedata.normalize("NFC", decomposed)


def test_unvoiced_pitch_frame_uses_explicit_nulls() -> None:
    frame = PitchFrame(
        time_ms=100,
        frequency_hz=None,
        midi=None,
        confidence=0.1,
        voiced=False,
    )
    assert frame.frequency_hz is None
