import argparse
import time
from collections.abc import Callable, Sequence

from sqlalchemy import Engine, create_engine, text

from swaram_worker.settings import WorkerSettings


class Worker:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def poll_once(self) -> None:
        """Verify PostgreSQL connectivity for one idle baseline cycle."""
        with self._engine.connect() as connection:
            connection.execute(text("SELECT 1"))

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
