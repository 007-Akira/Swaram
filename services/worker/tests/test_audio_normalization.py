import shutil
import struct
import wave
from pathlib import Path

import pytest
from swaram_worker.audio_normalization import (
    AudioProcessingError,
    FFmpegLimits,
    FFmpegNormalizer,
    IsolatedAudioWorkspace,
)

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="FFmpeg tooling is unavailable",
)


def write_tone(path: Path, duration_seconds: float = 0.1) -> None:
    sample_rate = 8000
    samples = int(sample_rate * duration_seconds)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"".join(struct.pack("<h", 1000) for _ in range(samples)))


def test_probe_and_normalize_valid_audio_with_misleading_extension(tmp_path) -> None:
    source = tmp_path / "actually-wav.mp3"
    write_tone(source)
    normalizer = FFmpegNormalizer()
    with IsolatedAudioWorkspace(tmp_path) as workspace:
        staged = workspace.stage_input(source)
        normalized = normalizer.normalize(staged, workspace.path)
        assert normalized.source.streams[0].codec == "pcm_s16le"
        assert normalized.source.streams[0].sample_rate_hz == 8000
        with wave.open(str(normalized.playback_wav), "rb") as playback:
            assert playback.getnchannels() == 2
            assert playback.getframerate() == 44_100
        with wave.open(str(normalized.analysis_wav), "rb") as analysis:
            assert analysis.getnchannels() == 1
            assert analysis.getframerate() == 22_050
        workspace_path = workspace.path
    assert not workspace_path.exists()


@pytest.mark.parametrize(
    ("content", "expected_code"),
    [(b"not audio", "audio_probe_failed"), (b"RIFF\x00\x00\x00\x00WAVE", "audio_probe_failed")],
)
def test_corrupt_and_truncated_files_are_rejected(
    tmp_path, content: bytes, expected_code: str
) -> None:
    source = tmp_path / "corrupt.wav"
    source.write_bytes(content)
    with pytest.raises(AudioProcessingError) as captured:
        FFmpegNormalizer().probe(source)
    assert captured.value.code == expected_code
    assert len(str(captured.value)) <= 2100


def test_size_and_duration_limits_are_enforced(tmp_path) -> None:
    source = tmp_path / "tone.wav"
    write_tone(source, duration_seconds=0.2)
    with pytest.raises(AudioProcessingError) as size_error:
        FFmpegNormalizer(limits=FFmpegLimits(maximum_input_bytes=10)).probe(source)
    assert size_error.value.code == "audio_too_large"
    with pytest.raises(AudioProcessingError) as duration_error:
        FFmpegNormalizer(limits=FFmpegLimits(maximum_duration_seconds=0.05)).probe(source)
    assert duration_error.value.code == "audio_too_long"


def test_missing_tool_has_structured_failure(tmp_path) -> None:
    source = tmp_path / "tone.wav"
    write_tone(source)
    with pytest.raises(AudioProcessingError) as captured:
        FFmpegNormalizer(ffprobe_binary="definitely-not-ffprobe").probe(source)
    assert captured.value.code == "audio_tool_unavailable"
