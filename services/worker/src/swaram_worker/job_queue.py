from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy import Connection, Engine, text


@dataclass(frozen=True)
class ClaimedJob:
    id: UUID
    session_id: UUID
    asset_id: UUID
    analysis_version: str
    attempt_count: int


class PostgreSQLJobQueue:
    def __init__(self, engine: Engine, worker_id: str, lease_seconds: int = 120) -> None:
        self._engine = engine
        self._worker_id = worker_id
        self._lease_seconds = lease_seconds

    def recover_stale(self, connection: Connection) -> int:
        result = connection.execute(
            text(
                """
                UPDATE processing_jobs
                SET state = 'QUEUED', claimed_by = NULL, lease_expires_at = NULL,
                    heartbeat_at = NULL, available_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE state = 'RUNNING' AND lease_expires_at < CURRENT_TIMESTAMP
                """
            )
        )
        return result.rowcount

    def claim_next(self) -> ClaimedJob | None:
        with self._engine.begin() as connection:
            self.recover_stale(connection)
            row = (
                connection.execute(
                    text(
                        """
                    WITH candidate AS (
                        SELECT id
                        FROM processing_jobs
                        WHERE state = 'QUEUED' AND available_at <= CURRENT_TIMESTAMP
                        ORDER BY created_at
                        FOR UPDATE SKIP LOCKED
                        LIMIT 1
                    )
                    UPDATE processing_jobs AS job
                    SET state = 'RUNNING',
                        claimed_by = :worker_id,
                        heartbeat_at = CURRENT_TIMESTAMP,
                        lease_expires_at = CURRENT_TIMESTAMP
                            + make_interval(secs => :lease_seconds),
                        attempt_count = attempt_count + 1,
                        updated_at = CURRENT_TIMESTAMP
                    FROM candidate
                    WHERE job.id = candidate.id
                    RETURNING job.id, job.session_id, job.asset_id,
                              job.analysis_version, job.attempt_count
                    """
                    ),
                    {"worker_id": self._worker_id, "lease_seconds": self._lease_seconds},
                )
                .mappings()
                .one_or_none()
            )
        if row is None:
            return None
        return ClaimedJob(
            id=row["id"],
            session_id=row["session_id"],
            asset_id=row["asset_id"],
            analysis_version=row["analysis_version"],
            attempt_count=row["attempt_count"],
        )

    def heartbeat(self, job_id: UUID) -> bool:
        with self._engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    UPDATE processing_jobs
                    SET heartbeat_at = CURRENT_TIMESTAMP,
                        lease_expires_at = CURRENT_TIMESTAMP
                            + make_interval(secs => :lease_seconds),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :job_id AND state = 'RUNNING' AND claimed_by = :worker_id
                    """
                ),
                {
                    "job_id": job_id,
                    "worker_id": self._worker_id,
                    "lease_seconds": self._lease_seconds,
                },
            )
        return result.rowcount == 1

    def succeed(self, job_id: UUID) -> bool:
        return self._finish(job_id, "SUCCEEDED", None)

    def fail(self, job_id: UUID, failure_code: str) -> bool:
        return self._finish(job_id, "FAILED", failure_code)

    def _finish(self, job_id: UUID, state: str, failure_code: str | None) -> bool:
        with self._engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    UPDATE processing_jobs
                    SET state = :state,
                        progress = CASE
                            WHEN :state = 'SUCCEEDED' THEN 100 ELSE progress
                        END,
                        failure_code = :failure_code, failure_detail = NULL,
                        finished_at = CURRENT_TIMESTAMP, lease_expires_at = NULL,
                        heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :job_id AND state = 'RUNNING' AND claimed_by = :worker_id
                    """
                ),
                {
                    "job_id": job_id,
                    "worker_id": self._worker_id,
                    "state": state,
                    "failure_code": failure_code,
                },
            )
        return result.rowcount == 1

    def retry(self, job_id: UUID, delay: timedelta) -> bool:
        delay_seconds = max(0, int(delay.total_seconds()))
        with self._engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    UPDATE processing_jobs
                    SET state = 'QUEUED', claimed_by = NULL, lease_expires_at = NULL,
                        heartbeat_at = NULL,
                        available_at = CURRENT_TIMESTAMP + make_interval(secs => :delay_seconds),
                        failure_code = NULL, failure_detail = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :job_id AND state IN ('RUNNING', 'FAILED')
                        AND (claimed_by = :worker_id OR claimed_by IS NULL)
                    """
                ),
                {
                    "job_id": job_id,
                    "worker_id": self._worker_id,
                    "delay_seconds": delay_seconds,
                },
            )
        return result.rowcount == 1
