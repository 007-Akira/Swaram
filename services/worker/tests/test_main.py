import pytest
from swaram_worker.main import main


def test_worker_shell(capsys: pytest.CaptureFixture[str]) -> None:
    main()
    assert capsys.readouterr().out == "Swaram worker shell\n"
