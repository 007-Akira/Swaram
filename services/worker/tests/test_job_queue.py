from datetime import timedelta
from unittest.mock import MagicMock
from uuid import uuid4

from sqlalchemy import Engine
from swaram_worker.job_queue import PostgreSQLJobQueue


def queue_with_result(rowcount: int = 1):
    engine = MagicMock(spec=Engine)
    connection = engine.begin.return_value.__enter__.return_value
    connection.execute.return_value.rowcount = rowcount
    return PostgreSQLJobQueue(engine, "worker-test"), connection


def test_claim_uses_skip_locked_and_returns_claimed_job() -> None:
    queue, connection = queue_with_result()
    row = {
        "id": uuid4(),
        "session_id": uuid4(),
        "asset_id": uuid4(),
        "analysis_version": "1.0",
        "attempt_count": 1,
    }
    connection.execute.return_value.mappings.return_value.one_or_none.return_value = row
    claimed = queue.claim_next()
    assert claimed is not None
    assert claimed.id == row["id"]
    claim_sql = str(connection.execute.call_args_list[-1].args[0])
    assert "FOR UPDATE SKIP LOCKED" in claim_sql
    assert "lease_expires_at" in claim_sql


def test_heartbeat_finish_and_retry_are_owner_guarded() -> None:
    queue, connection = queue_with_result()
    job_id = uuid4()
    assert queue.heartbeat(job_id) is True
    assert "claimed_by = :worker_id" in str(connection.execute.call_args.args[0])
    assert queue.succeed(job_id) is True
    assert queue.fail(job_id, "audio_decode_failed") is True
    assert queue.retry(job_id, timedelta(seconds=5)) is True


def test_failed_guarded_update_returns_false() -> None:
    queue, _connection = queue_with_result(rowcount=0)
    assert queue.heartbeat(uuid4()) is False
