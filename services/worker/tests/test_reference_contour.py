import wave
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest
import soundfile
from swaram_worker.reference_contour import ANALYSIS_SAMPLE_RATE, ContourError, analyze_wav


def _tone(frequency_hz: float, duration_seconds: float) -> np.ndarray:
    times = np.arange(round(ANALYSIS_SAMPLE_RATE * duration_seconds)) / ANALYSIS_SAMPLE_RATE
    return 0.5 * np.sin(2 * np.pi * frequency_hz * times)


def _write_wav(path: Path, audio: np.ndarray) -> None:
    soundfile.write(path, audio, ANALYSIS_SAMPLE_RATE, subtype="PCM_16")


def _voiced_frequencies(path: Path) -> list[float]:
    package = analyze_wav(path, uuid4(), confidence_threshold=0.5)
    return [
        frame.frequency_hz
        for frame in package.pitch_frames
        if frame.voiced and frame.frequency_hz is not None
    ]


def test_sine_tone_tracks_a4(tmp_path: Path) -> None:
    path = tmp_path / "a4.wav"
    _write_wav(path, _tone(440, 1.2))
    frequencies = _voiced_frequencies(path)
    assert frequencies
    assert float(np.median(frequencies)) == pytest.approx(440, abs=3)


def test_rest_remains_explicitly_unvoiced(tmp_path: Path) -> None:
    path = tmp_path / "tone-rest-tone.wav"
    audio = np.concatenate(
        [
            _tone(440, 0.6),
            np.zeros(round(0.6 * ANALYSIS_SAMPLE_RATE)),
            _tone(440, 0.6),
        ]
    )
    _write_wav(path, audio)
    package = analyze_wav(path, uuid4(), confidence_threshold=0.5)
    middle = [frame for frame in package.pitch_frames if 750 <= frame.time_ms <= 1_050]
    assert middle
    assert sum(not frame.voiced for frame in middle) / len(middle) > 0.8


def test_octave_transition_is_retained(tmp_path: Path) -> None:
    path = tmp_path / "octave.wav"
    _write_wav(path, np.concatenate([_tone(220, 0.8), _tone(440, 0.8)]))
    package = analyze_wav(path, uuid4(), confidence_threshold=0.5)
    early = [
        frame.frequency_hz
        for frame in package.pitch_frames
        if frame.voiced and frame.frequency_hz is not None and 200 <= frame.time_ms <= 650
    ]
    late = [
        frame.frequency_hz
        for frame in package.pitch_frames
        if frame.voiced and frame.frequency_hz is not None and 1_000 <= frame.time_ms <= 1_450
    ]
    assert float(np.median(early)) == pytest.approx(220, abs=4)
    assert float(np.median(late)) == pytest.approx(440, abs=4)


def test_rejects_unsupported_and_empty_audio(tmp_path: Path) -> None:
    unsupported = tmp_path / "song.mp3"
    unsupported.write_bytes(b"not audio")
    with pytest.raises(ContourError, match="must be a WAV"):
        analyze_wav(unsupported, uuid4())

    empty = tmp_path / "empty.wav"
    with wave.open(str(empty), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(ANALYSIS_SAMPLE_RATE)
    with pytest.raises(ContourError, match="no audio frames"):
        analyze_wav(empty, uuid4())
