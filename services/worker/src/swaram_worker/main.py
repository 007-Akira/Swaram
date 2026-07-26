import argparse
import shutil
import signal
import socket
import tempfile
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from threading import Event

from sqlalchemy import Engine, create_engine, text

from swaram_worker.analysis_pipeline import AnalysisPipeline
from swaram_worker.audio_normalization import FFmpegLimits, FFmpegNormalizer
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
        self,
        poll_interval_seconds: float,
        sleep: Callable[[float], None] = time.sleep,
        stop_requested: Callable[[], bool] = lambda: False,
    ) -> None:
        while not stop_requested():
            self.poll_once()
            if not stop_requested():
                sleep(poll_interval_seconds)


def readiness_check(engine: Engine, private_data_root: Path, temp_root: Path | None) -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    private_data_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="swaram-ready-", dir=temp_root):
        pass
    for binary in ("ffmpeg", "ffprobe"):
        if shutil.which(binary) is None:
            raise RuntimeError(f"{binary} is unavailable")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Swaram PostgreSQL worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="perform one idle PostgreSQL polling cycle and exit",
    )
    parser.add_argument(
        "--healthcheck",
        action="store_true",
        help="verify database, storage, temporary workspace, and audio tooling",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    settings = WorkerSettings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    if args.healthcheck:
        try:
            readiness_check(engine, settings.private_data_root, settings.worker_temp_root)
        finally:
            engine.dispose()
        return
    worker_id = f"{socket.gethostname()}-{id(engine)}"
    queue = PostgreSQLJobQueue(engine, worker_id, settings.job_lease_seconds)
    pipeline = AnalysisPipeline(
        engine,
        WorkerPrivateStorage(settings.private_data_root),
        queue,
        FFmpegNormalizer(
            limits=FFmpegLimits(
                maximum_input_bytes=settings.audio_max_bytes,
                maximum_duration_seconds=settings.audio_max_duration_seconds,
                command_timeout_seconds=settings.ffmpeg_timeout_seconds,
                maximum_decoded_bytes=settings.decoded_audio_max_bytes,
            )
        ),
        HTDemucsSeparator(
            device=settings.stem_device,
            command_timeout_seconds=settings.demucs_timeout_seconds,
        ),
        settings.worker_temp_root,
    )
    worker = Worker(engine, queue=queue, processor=pipeline.process)
    stopping = Event()

    def request_stop(_signal: int, _frame: object) -> None:
        stopping.set()

    previous_handlers = {
        signal_number: signal.signal(signal_number, request_stop)
        for signal_number in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        if args.once:
            worker.poll_once()
        else:
            worker.run(
                settings.worker_poll_interval_seconds,
                stop_requested=stopping.is_set,
            )
    finally:
        for signal_number, previous in previous_handlers.items():
            signal.signal(signal_number, previous)
        engine.dispose()
