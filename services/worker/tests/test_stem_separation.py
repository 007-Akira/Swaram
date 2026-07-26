import os
import shutil
import subprocess
import wave
from pathlib import Path
from unittest.mock import patch

import pytest
from swaram_worker.audio_normalization import AudioProcessingError
from swaram_worker.stem_separation import MODEL_ID, HTDemucsSeparator


def fake_success(command: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
    output_root = Path(command[command.index("--out") + 1])
    input_path = Path(command[-1])
    stem_directory = output_root / MODEL_ID / input_path.stem
    stem_directory.mkdir(parents=True)
    (stem_directory / "vocals.wav").write_bytes(b"vocals")
    (stem_directory / "no_vocals.wav").write_bytes(b"instrumental")
    return subprocess.CompletedProcess(command, 0, "", "")


def test_separator_uses_argument_array_reports_progress_and_cleans_temp(tmp_path) -> None:
    source = tmp_path / "playback.wav"
    source.write_bytes(b"normalized")
    stages: list[tuple[str, int]] = []
    with patch("swaram_worker.stem_separation.subprocess.run", side_effect=fake_success) as run:
        stems = HTDemucsSeparator(device="cpu").separate(
            source, tmp_path, lambda stage, percent: stages.append((stage, percent))
        )
    command = run.call_args.args[0]
    assert command[1:3] == ["-m", "demucs.separate"]
    assert command[command.index("--device") + 1] == "cpu"
    assert run.call_args.kwargs["shell"] is False
    assert stems.vocals_wav.read_bytes() == b"vocals"
    assert stems.instrumental_wav.read_bytes() == b"instrumental"
    assert stems.model_id == "htdemucs"
    assert stages == [
        ("stem_separation_preparing", 25),
        ("stem_separation_running", 30),
        ("stem_separation_complete", 55),
    ]
    assert not list(tmp_path.glob("demucs-*"))


def test_separator_cleans_temporary_outputs_after_failure(tmp_path) -> None:
    source = tmp_path / "playback.wav"
    source.write_bytes(b"normalized")
    failure = subprocess.CompletedProcess([], 1, "", "model failed")
    with (
        patch("swaram_worker.stem_separation.subprocess.run", return_value=failure),
        pytest.raises(AudioProcessingError) as captured,
    ):
        HTDemucsSeparator().separate(source, tmp_path)
    assert captured.value.code == "stem_separation_failed"
    assert not list(tmp_path.glob("demucs-*"))
    assert not (tmp_path / "vocals.wav").exists()


def test_device_configuration_is_explicit() -> None:
    with pytest.raises(ValueError):
        HTDemucsSeparator(device="gpu")  # type: ignore[arg-type]
    HTDemucsSeparator(device="auto")
    HTDemucsSeparator(device="cuda")
    HTDemucsSeparator(device="mps")


@pytest.mark.skipif(
    os.environ.get("RUN_AUDIO_INTEGRATION") != "1",
    reason="set RUN_AUDIO_INTEGRATION=1 with an authorized audio fixture",
)
def test_opt_in_authorized_htdemucs_integration(tmp_path) -> None:
    fixture_value = os.environ.get("SWARAM_AUTHORIZED_AUDIO")
    if not fixture_value:
        pytest.fail("SWARAM_AUTHORIZED_AUDIO must name an authorized local audio file")
    fixture = Path(fixture_value)
    if shutil.which("ffmpeg") is None:
        pytest.fail("FFmpeg is required")
    stems = HTDemucsSeparator(device="cpu").separate(fixture, tmp_path)
    for path in (stems.vocals_wav, stems.instrumental_wav):
        assert path.stat().st_size > 44
        with wave.open(str(path), "rb") as audio:
            assert audio.getnframes() > 0
