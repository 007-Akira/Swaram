import argparse
import socket
import time
from collections.abc import Callable, Sequence

from sqlalchemy import Engine, create_engine

from swaram_worker.job_queue import ClaimedJob, PostgreSQLJobQueue
from swaram_worker.settings import WorkerSettings


class Worker:
    def __init__(self, engine: Engine, worker_id: str | None = None) -> None:
        self._engine = engine
        self._queue = PostgreSQLJobQueue(engine, worker_id or f"{socket.gethostname()}-{id(self)}")

    def poll_once(self) -> ClaimedJob | None:
        """Recover stale leases and claim at most one durable processing job."""
        return self._queue.claim_next()

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
    worker = Worker(engine)
    try:
        if args.once:
            worker.poll_once()
        else:
            worker.run(settings.worker_poll_interval_seconds)
    finally:
        engine.dispose()
