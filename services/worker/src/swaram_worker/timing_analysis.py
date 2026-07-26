from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from pathlib import Path

import librosa
import numpy as np
import numpy.typing as npt
import soundfile  # type: ignore[import-untyped]

from swaram_worker.reference_contour import ANALYSIS_SAMPLE_RATE, ContourError

HOP_LENGTH = 512
MAX_ENERGY_POINTS = 1_000
MIN_SECTION_SECONDS = 5.0


@dataclass(frozen=True)
class EnergyPoint:
    time_ms: int
    rms: float


@dataclass(frozen=True)
class GenericSection:
    label: str
    start_ms: int
    end_ms: int
    confidence: float


@dataclass(frozen=True)
class TimingMetadata:
    duration_seconds: float
    estimated_tempo_bpm: float | None
    tempo_confidence: float
    tempo_limitation: str
    beat_timestamps_ms: list[int]
    energy_envelope: list[EnergyPoint]
    sections: list[GenericSection]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def _tempo_confidence(beat_times: npt.NDArray[np.float64], duration: float) -> float:
    if len(beat_times) < 3 or duration <= 0:
        return 0.0
    intervals = np.diff(beat_times)
    mean_interval = float(np.mean(intervals))
    if mean_interval <= 0:
        return 0.0
    regularity = max(0.0, 1.0 - float(np.std(intervals) / mean_interval))
    coverage = min(1.0, float(beat_times[-1] - beat_times[0]) / duration)
    count_factor = min(1.0, len(beat_times) / 8)
    return round(regularity * coverage * count_factor, 3)


def _downsample_energy(
    times: npt.NDArray[np.float64], rms: npt.NDArray[np.float64]
) -> list[EnergyPoint]:
    if len(rms) > MAX_ENERGY_POINTS:
        indices = np.unique(np.linspace(0, len(rms) - 1, MAX_ENERGY_POINTS, dtype=np.int64))
    else:
        indices = np.arange(len(rms))
    return [
        EnergyPoint(time_ms=round(float(times[index]) * 1000), rms=float(rms[index]))
        for index in indices
    ]


def _generic_sections(
    rms: npt.NDArray[np.float64],
    times: npt.NDArray[np.float64],
    duration: float,
) -> list[GenericSection]:
    if duration < MIN_SECTION_SECONDS * 2 or len(rms) < 4:
        return []
    dynamic_range = float(np.percentile(rms, 90) - np.percentile(rms, 10))
    if dynamic_range < 0.005:
        return []
    novelty = np.abs(np.diff(rms, prepend=rms[0]))
    threshold = max(dynamic_range * 0.2, float(np.percentile(novelty, 92)))
    if threshold <= 0:
        return []
    candidates = np.flatnonzero(novelty >= threshold)
    boundaries = [0.0]
    for candidate in candidates:
        candidate_time = float(times[candidate])
        if (
            candidate_time - boundaries[-1] >= MIN_SECTION_SECONDS
            and duration - candidate_time >= MIN_SECTION_SECONDS
        ):
            boundaries.append(candidate_time)
    boundaries.append(duration)
    if len(boundaries) <= 2:
        return []
    sections = []
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:], strict=False), start=1):
        confidence = min(1.0, dynamic_range / 0.1)
        sections.append(
            GenericSection(
                label=f"section_{index}",
                start_ms=round(start * 1000),
                end_ms=round(end * 1000),
                confidence=round(confidence, 3),
            )
        )
    return sections


def analyze_timing(input_path: Path) -> TimingMetadata:
    try:
        audio, _ = librosa.load(input_path, sr=ANALYSIS_SAMPLE_RATE, mono=True)
    except (OSError, RuntimeError, soundfile.LibsndfileError) as error:
        raise ContourError(f"Unable to decode timing-analysis WAV: {error}") from error
    if audio.size == 0 or not np.all(np.isfinite(audio)):
        raise ContourError("Timing-analysis WAV contains no valid audio")
    duration = float(audio.size / ANALYSIS_SAMPLE_RATE)
    rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=HOP_LENGTH)[0]
    times = librosa.frames_to_time(
        np.arange(len(rms)), sr=ANALYSIS_SAMPLE_RATE, hop_length=HOP_LENGTH
    )
    onset_envelope = librosa.onset.onset_strength(
        y=audio, sr=ANALYSIS_SAMPLE_RATE, hop_length=HOP_LENGTH
    )
    tempo_value, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_envelope,
        sr=ANALYSIS_SAMPLE_RATE,
        hop_length=HOP_LENGTH,
        units="frames",
    )
    tempo = float(np.asarray(tempo_value).reshape(-1)[0])
    beat_times = np.asarray(
        librosa.frames_to_time(beat_frames, sr=ANALYSIS_SAMPLE_RATE, hop_length=HOP_LENGTH),
        dtype=np.float64,
    )
    confidence = _tempo_confidence(beat_times, duration)
    usable_tempo = tempo if math.isfinite(tempo) and tempo > 0 and confidence > 0 else None
    return TimingMetadata(
        duration_seconds=duration,
        estimated_tempo_bpm=usable_tempo,
        tempo_confidence=confidence,
        tempo_limitation=(
            "Tempo is an onset-based estimate and may be unreliable for rubato, "
            "sparse, or non-percussive music."
        ),
        beat_timestamps_ms=[round(float(value) * 1000) for value in beat_times],
        energy_envelope=_downsample_energy(times, rms),
        sections=_generic_sections(rms, times, duration),
    )
