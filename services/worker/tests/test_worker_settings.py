import pytest
from pydantic import ValidationError
from swaram_worker.settings import WorkerSettings


def test_poll_interval_must_be_positive() -> None:
    with pytest.raises(ValidationError, match="greater than 0"):
        WorkerSettings(worker_poll_interval_seconds=0, _env_file=None)


def test_production_worker_requires_absolute_private_and_temp_roots() -> None:
    values = {
        "app_env": "production",
        "database_url": "postgresql+psycopg://user:secret@db/swaram",
        "_env_file": None,
    }
    with pytest.raises(ValidationError, match="PRIVATE_DATA_ROOT"):
        WorkerSettings(**values, private_data_root="data", worker_temp_root="/tmp/work")
    with pytest.raises(ValidationError, match="WORKER_TEMP_ROOT"):
        WorkerSettings(**values, private_data_root="/data")
    settings = WorkerSettings(
        **values,
        private_data_root="/data",
        worker_temp_root="/var/tmp/swaram",
    )
    assert settings.job_lease_seconds == 120
