from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

from sqlalchemy import Engine
from swaram_contracts import PitchFrame
from swaram_worker.analysis_pipeline import AnalysisPipeline, JobInput
from swaram_worker.job_queue import ClaimedJob, PostgreSQLJobQueue
from swaram_worker.private_storage import WorkerPrivateStorage
from swaram_worker.reference_contour import ContourExtraction, ContourMetadata
from swaram_worker.stem_separation import HTDemucsSeparator
from swaram_worker.timing_analysis import EnergyPoint, GenericSection, TimingMetadata


def test_package_is_compact_schema_valid_and_hides_raw_debug_frames(tmp_path) -> None:
    engine = MagicMock(spec=Engine)
    pipeline = AnalysisPipeline(
        engine,
        WorkerPrivateStorage(tmp_path),
        MagicMock(spec=PostgreSQLJobQueue),
        MagicMock(),
        HTDemucsSeparator(),
    )
    frame = PitchFrame(time_ms=0, frequency_hz=440, midi=69, confidence=0.9, voiced=True)
    contour = ContourExtraction(
        browser_frames=[frame],
        raw_debug_frames=[frame, frame],
        metadata=ContourMetadata(440, 440, 0.5, 2, 1),
    )
    timing = TimingMetadata(
        duration_seconds=1,
        estimated_tempo_bpm=120,
        tempo_confidence=0.6,
        tempo_limitation="Estimate.",
        beat_timestamps_ms=[500],
        energy_envelope=[EnergyPoint(0, 0.1)],
        sections=[GenericSection("section_1", 0, 1000, 0.5)],
    )
    package = pipeline._build_package(
        ClaimedJob(uuid4(), uuid4(), uuid4(), "1.0", 1),
        JobInput("key", "a" * 64, datetime.now(UTC)),
        contour,
        1,
        timing,
        "htdemucs",
    )
    payload = package.model_dump(mode="json")
    assert "raw_pitch_frames" not in payload
    assert payload["input_checksum_sha256"] == "a" * 64
    assert payload["model_identifier"] == "htdemucs"
    assert payload["voiced_coverage"] == 0.5
    assert payload["sections"][0]["label"] == "section_1"
