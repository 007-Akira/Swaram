import pytest
from pydantic import ValidationError
from swaram_worker.settings import WorkerSettings


def test_poll_interval_must_be_positive() -> None:
    with pytest.raises(ValidationError, match="must be positive"):
        WorkerSettings(worker_poll_interval_seconds=0, _env_file=None)
