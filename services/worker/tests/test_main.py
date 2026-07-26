from unittest.mock import MagicMock

from sqlalchemy import Engine
from swaram_worker.main import Worker, build_parser


def test_worker_performs_one_idle_poll() -> None:
    engine = MagicMock(spec=Engine)
    connection = engine.begin.return_value.__enter__.return_value
    connection.execute.return_value.mappings.return_value.one_or_none.return_value = None

    assert Worker(engine).poll_once() is None

    engine.begin.assert_called_once_with()
    statements = [str(call.args[0]) for call in connection.execute.call_args_list]
    assert any("FOR UPDATE SKIP LOCKED" in statement for statement in statements)


def test_once_command_line_flag() -> None:
    assert build_parser().parse_args(["--once"]).once is True
