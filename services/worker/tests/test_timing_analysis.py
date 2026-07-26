import json
from pathlib import Path

import numpy as np
import soundfile
from swaram_worker.reference_contour import ANALYSIS_SAMPLE_RATE
from swaram_worker.timing_analysis import analyze_timing


def write_audio(path: Path, audio: np.ndarray) -> None:
    soundfile.write(path, audio, ANALYSIS_SAMPLE_RATE, subtype="PCM_16")


def test_timing_metadata_is_serializable_and_beats_are_ordered(tmp_path) -> None:
    duration = 12
    audio = np.zeros(ANALYSIS_SAMPLE_RATE * duration)
    for second in np.arange(0.5, duration, 0.5):
        start = round(second * ANALYSIS_SAMPLE_RATE)
        audio[start : start + 200] = np.hanning(200)
    path = tmp_path / "clicks.wav"
    write_audio(path, audio)
    metadata = analyze_timing(path)
    serialized = json.loads(json.dumps(metadata.to_dict()))
    assert serialized["duration_seconds"] == duration
    assert metadata.estimated_tempo_bpm is not None
    assert 100 <= metadata.estimated_tempo_bpm <= 140
    assert metadata.beat_timestamps_ms == sorted(metadata.beat_timestamps_ms)
    assert all(point.time_ms >= 0 and point.rms >= 0 for point in metadata.energy_envelope)


def test_section_boundaries_are_generic_nonoverlapping_and_ordered(tmp_path) -> None:
    duration = 20
    first = np.zeros(ANALYSIS_SAMPLE_RATE * 7)
    middle = np.full(ANALYSIS_SAMPLE_RATE * 7, 0.08)
    last = np.full(ANALYSIS_SAMPLE_RATE * 6, 0.3)
    path = tmp_path / "sections.wav"
    write_audio(path, np.concatenate([first, middle, last]))
    sections = analyze_timing(path).sections
    assert sections
    assert [section.label for section in sections] == [
        f"section_{index}" for index in range(1, len(sections) + 1)
    ]
    assert sections[0].start_ms == 0
    assert sections[-1].end_ms == duration * 1000
    assert all(
        current.end_ms == following.start_ms
        for current, following in zip(sections, sections[1:], strict=False)
    )


def test_low_confidence_silence_is_non_blocking(tmp_path) -> None:
    path = tmp_path / "silence.wav"
    write_audio(path, np.zeros(ANALYSIS_SAMPLE_RATE * 2))
    metadata = analyze_timing(path)
    assert metadata.estimated_tempo_bpm is None
    assert metadata.tempo_confidence == 0
    assert metadata.beat_timestamps_ms == []
    assert metadata.sections == []
