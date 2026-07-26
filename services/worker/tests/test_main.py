from unittest.mock import MagicMock

from sqlalchemy import Engine
from swaram_worker.main import Worker, build_parser


def test_worker_performs_one_idle_poll() -> None:
    engine = MagicMock(spec=Engine)
    connection = engine.connect.return_value.__enter__.return_value

    Worker(engine).poll_once()

    engine.connect.assert_called_once_with()
    connection.execute.assert_called_once()


def test_once_command_line_flag() -> None:
    assert build_parser().parse_args(["--once"]).once is True
