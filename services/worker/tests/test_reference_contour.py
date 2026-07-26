import wave
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest
import soundfile
from swaram_worker.reference_contour import (
    ANALYSIS_SAMPLE_RATE,
    ContourConfig,
    ContourError,
    _correct_isolated_octaves,
    _reject_implausible_jumps,
    analyze_wav,
    extract_contour,
)


def _tone(frequency_hz: float, duration_seconds: float) -> np.ndarray:
    times = np.arange(round(ANALYSIS_SAMPLE_RATE * duration_seconds)) / ANALYSIS_SAMPLE_RATE
    return 0.5 * np.sin(2 * np.pi * frequency_hz * times)


def _varying_tone(frequencies_hz: np.ndarray) -> np.ndarray:
    phase = 2 * np.pi * np.cumsum(frequencies_hz) / ANALYSIS_SAMPLE_RATE
    return 0.5 * np.sin(phase)


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


def test_glide_and_vibrato_are_not_flattened(tmp_path: Path) -> None:
    duration = 1.5
    times = np.arange(round(ANALYSIS_SAMPLE_RATE * duration)) / ANALYSIS_SAMPLE_RATE
    glide = 220 + (110 * times / duration)
    vibrato = glide * np.power(2, (0.35 * np.sin(2 * np.pi * 5 * times)) / 12)
    path = tmp_path / "glide-vibrato.wav"
    _write_wav(path, _varying_tone(vibrato))
    extraction, _duration = extract_contour(
        path, ContourConfig(confidence_threshold=0.4, browser_max_frames=40)
    )
    voiced = [frame.midi for frame in extraction.browser_frames if frame.midi is not None]
    assert len(extraction.browser_frames) <= 40
    assert voiced[-1] - voiced[0] > 5
    assert len({round(value, 1) for value in voiced}) > 10
    assert extraction.metadata.voiced_coverage > 0.7
    assert extraction.metadata.minimum_frequency_hz is not None
    assert extraction.metadata.maximum_frequency_hz is not None


def test_local_octave_correction_requires_two_sided_continuity() -> None:
    isolated_error = np.array([57.0, 57.1, 69.0, 57.2, 57.1])
    corrected = _correct_isolated_octaves(isolated_error)
    assert corrected[2] == pytest.approx(57.0, abs=0.2)
    real_octave = np.array([57.0, 57.0, 69.0, 69.0, 69.0])
    assert np.array_equal(_correct_isolated_octaves(real_octave), real_octave)


def test_implausible_isolated_jump_is_rejected_but_sustained_octave_is_retained() -> None:
    values = np.array([60.0, 60.1, 78.0, 60.2, 72.0, 72.1, 72.2])
    cleaned = _reject_implausible_jumps(values, 7)
    assert np.isnan(cleaned[2])
    assert np.all(np.isfinite(cleaned[4:]))


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
