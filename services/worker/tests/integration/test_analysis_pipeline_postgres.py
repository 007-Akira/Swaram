import hashlib
import os
import shutil
import struct
import wave
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from swaram_worker.analysis_pipeline import AnalysisPipeline
from swaram_worker.audio_normalization import FFmpegNormalizer
from swaram_worker.job_queue import ClaimedJob, PostgreSQLJobQueue
from swaram_worker.private_storage import WorkerPrivateStorage
from swaram_worker.stem_separation import SeparatedStems

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured"),
    pytest.mark.skipif(
        shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
        reason="FFmpeg is unavailable",
    ),
]


class CopySeparator:
    def separate(self, source: Path, workspace: Path, progress) -> SeparatedStems:
        vocals = workspace / "vocals.wav"
        instrumental = workspace / "instrumental.wav"
        shutil.copyfile(source, vocals)
        shutil.copyfile(source, instrumental)
        progress("stem_separation_complete", 55)
        return SeparatedStems(vocals, instrumental, "htdemucs-test-double", "cpu")


def write_tone(path: Path) -> None:
    sample_rate = 22_050
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(
            b"".join(
                struct.pack(
                    "<h",
                    round(
                        8000
                        * __import__("math").sin(
                            2 * __import__("math").pi * 440 * index / sample_rate
                        )
                    ),
                )
                for index in range(sample_rate)
            )
        )


def test_pipeline_publishes_atomically_and_retry_is_idempotent(tmp_path) -> None:
    assert TEST_DATABASE_URL is not None
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    session_id, asset_id, job_id = uuid4(), uuid4(), uuid4()
    storage = WorkerPrivateStorage(tmp_path)
    source = tmp_path / "authorized-test-tone.wav"
    write_tone(source)
    stored_source = storage.store_file(session_id, source)
    expiry = datetime.now(UTC) + timedelta(hours=1)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO practice_sessions (id, owner_token_hash, expires_at)
                    VALUES (:id, :owner, :expiry)
                    """
                ),
                {"id": session_id, "owner": "a" * 64, "expiry": expiry},
            )
            connection.execute(
                text(
                    """
                    INSERT INTO uploaded_assets
                        (id, session_id, kind, object_key, media_type, size_bytes,
                         checksum_sha256, expires_at)
                    VALUES
                        (:id, :session_id, 'ORIGINAL_AUDIO', :key, 'audio/wav',
                         :size, :checksum, :expiry)
                    """
                ),
                {
                    "id": asset_id,
                    "session_id": session_id,
                    "key": stored_source.object_key,
                    "size": stored_source.size_bytes,
                    "checksum": stored_source.checksum_sha256,
                    "expiry": expiry,
                },
            )
            connection.execute(
                text(
                    """
                    INSERT INTO processing_jobs
                        (id, session_id, asset_id, analysis_version, state,
                         claimed_by, lease_expires_at, attempt_count)
                    VALUES
                        (:id, :session_id, :asset_id, '1.0', 'RUNNING',
                         'pipeline-test', CURRENT_TIMESTAMP + INTERVAL '5 minutes', 1)
                    """
                ),
                {"id": job_id, "session_id": session_id, "asset_id": asset_id},
            )
        queue = PostgreSQLJobQueue(engine, "pipeline-test")
        pipeline = AnalysisPipeline(
            engine,
            storage,
            queue,
            FFmpegNormalizer(),
            CopySeparator(),  # type: ignore[arg-type]
        )
        job = ClaimedJob(job_id, session_id, asset_id, "1.0", 1)
        package_id = pipeline.process(job)
        assert package_id is not None
        with engine.begin() as connection:
            state = connection.execute(
                text("SELECT state, progress, progress_stage FROM processing_jobs WHERE id = :id"),
                {"id": job_id},
            ).one()
            assert tuple(state) == ("SUCCEEDED", 100, "complete")
            package = connection.execute(
                text("SELECT object_key, checksum_sha256 FROM analysis_packages WHERE id = :id"),
                {"id": package_id},
            ).one()
            package_path = storage.path_for(session_id, package.object_key)
            assert hashlib.sha256(package_path.read_bytes()).hexdigest() == package.checksum_sha256
            assert b"raw_pitch_frames" not in package_path.read_bytes()
            connection.execute(
                text(
                    """
                    UPDATE processing_jobs
                    SET state = 'RUNNING', progress = 0, progress_stage = 'retry',
                        claimed_by = 'pipeline-test',
                        lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
                    WHERE id = :id
                    """
                ),
                {"id": job_id},
            )
        assert pipeline.process(ClaimedJob(job_id, session_id, asset_id, "1.0", 2)) == package_id
        with engine.connect() as connection:
            count = connection.scalar(
                text("SELECT count(*) FROM analysis_packages WHERE source_asset_id = :asset_id"),
                {"asset_id": asset_id},
            )
            assert count == 1
    finally:
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM practice_sessions WHERE id = :id"), {"id": session_id}
            )
        engine.dispose()
