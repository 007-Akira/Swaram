import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from swaram_worker.job_queue import PostgreSQLJobQueue

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.integration


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_concurrent_claim_idempotency_retry_and_stale_recovery() -> None:
    assert TEST_DATABASE_URL is not None
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    session_id = uuid4()
    asset_ids = [uuid4(), uuid4(), uuid4()]
    job_ids = [uuid4(), uuid4(), uuid4()]
    expiry = datetime.now(UTC) + timedelta(hours=1)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO practice_sessions
                        (id, owner_token_hash, expires_at)
                    VALUES (:id, :owner, :expiry)
                    """
                ),
                {"id": session_id, "owner": "a" * 64, "expiry": expiry},
            )
            for asset_id in asset_ids:
                connection.execute(
                    text(
                        """
                        INSERT INTO uploaded_assets
                            (id, session_id, kind, object_key, media_type, size_bytes,
                             checksum_sha256, expires_at)
                        VALUES
                            (:id, :session_id, 'ORIGINAL_AUDIO', :object_key,
                             'audio/wav', 1, :checksum, :expiry)
                        """
                    ),
                    {
                        "id": asset_id,
                        "session_id": session_id,
                        "object_key": str(asset_id),
                        "checksum": "b" * 64,
                        "expiry": expiry,
                    },
                )
            for job_id, asset_id in zip(job_ids[:2], asset_ids[:2], strict=True):
                connection.execute(
                    text(
                        """
                        INSERT INTO processing_jobs
                            (id, session_id, asset_id, analysis_version, state)
                        VALUES (:id, :session_id, :asset_id, '1.0', 'QUEUED')
                        """
                    ),
                    {"id": job_id, "session_id": session_id, "asset_id": asset_id},
                )

        queues = [PostgreSQLJobQueue(engine, f"worker-{number}") for number in range(2)]
        with ThreadPoolExecutor(max_workers=2) as executor:
            claimed = list(executor.map(lambda queue: queue.claim_next(), queues))
        assert all(job is not None for job in claimed)
        assert len({job.id for job in claimed if job is not None}) == 2

        assert queues[0].retry(claimed[0].id, timedelta()) is True  # type: ignore[union-attr]
        retried = queues[0].claim_next()
        assert retried is not None
        assert retried.attempt_count == 2

        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO processing_jobs
                        (id, session_id, asset_id, analysis_version, state,
                         claimed_by, lease_expires_at)
                    VALUES
                        (:id, :session_id, :asset_id, '1.0', 'RUNNING',
                         'abandoned', CURRENT_TIMESTAMP - INTERVAL '1 minute')
                    """
                ),
                {"id": job_ids[2], "session_id": session_id, "asset_id": asset_ids[2]},
            )
        recovered = PostgreSQLJobQueue(engine, "recovery-worker").claim_next()
        assert recovered is not None
        assert recovered.id == job_ids[2]

        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(
                text(
                    """
                        INSERT INTO processing_jobs
                            (id, session_id, asset_id, analysis_version, state)
                        VALUES (:id, :session_id, :asset_id, '1.0', 'QUEUED')
                        """
                ),
                {"id": uuid4(), "session_id": session_id, "asset_id": asset_ids[2]},
            )
    finally:
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM practice_sessions WHERE id = :id"), {"id": session_id}
            )
        engine.dispose()
