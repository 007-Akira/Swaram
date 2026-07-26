import pytest
from swaram_api.models import JobState, ProcessingJob


def test_job_state_machine_allows_explicit_transitions() -> None:
    job = ProcessingJob(state=JobState.QUEUED)
    job.transition_to(JobState.RUNNING)
    job.transition_to(JobState.SUCCEEDED)
    assert job.state is JobState.SUCCEEDED


def test_job_state_machine_rejects_invalid_transition() -> None:
    job = ProcessingJob(state=JobState.QUEUED)
    with pytest.raises(ValueError, match="queued -> succeeded"):
        job.transition_to(JobState.SUCCEEDED)
