import argparse
import socket
import time
from collections.abc import Callable, Sequence

from sqlalchemy import Engine, create_engine

from swaram_worker.analysis_pipeline import AnalysisPipeline
from swaram_worker.audio_normalization import FFmpegNormalizer
from swaram_worker.job_queue import ClaimedJob, PostgreSQLJobQueue
from swaram_worker.private_storage import WorkerPrivateStorage
from swaram_worker.settings import WorkerSettings
from swaram_worker.stem_separation import HTDemucsSeparator


class Worker:
    def __init__(
        self,
        engine: Engine,
        worker_id: str | None = None,
        *,
        queue: PostgreSQLJobQueue | None = None,
        processor: Callable[[ClaimedJob], object] | None = None,
    ) -> None:
        self._engine = engine
        self._queue = queue or PostgreSQLJobQueue(
            engine, worker_id or f"{socket.gethostname()}-{id(self)}"
        )
        self._processor = processor

    def poll_once(self) -> ClaimedJob | None:
        """Recover stale leases and claim at most one durable processing job."""
        job = self._queue.claim_next()
        if job is not None and self._processor is not None:
            self._processor(job)
        return job

    def run(
        self, poll_interval_seconds: float, sleep: Callable[[float], None] = time.sleep
    ) -> None:
        while True:
            self.poll_once()
            sleep(poll_interval_seconds)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Swaram PostgreSQL worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="perform one idle PostgreSQL polling cycle and exit",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    settings = WorkerSettings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    worker_id = f"{socket.gethostname()}-{id(engine)}"
    queue = PostgreSQLJobQueue(engine, worker_id)
    pipeline = AnalysisPipeline(
        engine,
        WorkerPrivateStorage(settings.private_data_root),
        queue,
        FFmpegNormalizer(),
        HTDemucsSeparator(device=settings.stem_device),
    )
    worker = Worker(engine, queue=queue, processor=pipeline.process)
    try:
        if args.once:
            worker.poll_once()
        else:
            worker.run(settings.worker_poll_interval_seconds)
    finally:
        engine.dispose()
