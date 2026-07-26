import argparse
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import librosa
import numpy as np
import numpy.typing as npt
import soundfile  # type: ignore[import-untyped]
from swaram_contracts import AnalysisPackageV1, PitchFrame

ANALYSIS_SAMPLE_RATE = 22_050
FRAME_LENGTH = 2_048
HOP_LENGTH = 256
MIN_FREQUENCY_HZ = float(librosa.note_to_hz("C2"))
MAX_FREQUENCY_HZ = float(librosa.note_to_hz("C7"))
DEFAULT_CONFIDENCE_THRESHOLD = 0.1
MAX_INTERPOLATED_GAP_FRAMES = 3
MEDIAN_WINDOW_FRAMES = 5
MAX_JUMP_SEMITONES = 7.0
OCTAVE_TOLERANCE_SEMITONES = 1.0
DEFAULT_BROWSER_MAX_FRAMES = 6_000


class ContourError(ValueError):
    pass


@dataclass(frozen=True)
class ContourConfig:
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD
    median_window_frames: int = MEDIAN_WINDOW_FRAMES
    maximum_gap_frames: int = MAX_INTERPOLATED_GAP_FRAMES
    maximum_jump_semitones: float = MAX_JUMP_SEMITONES
    browser_max_frames: int = DEFAULT_BROWSER_MAX_FRAMES


@dataclass(frozen=True)
class ContourMetadata:
    minimum_frequency_hz: float | None
    maximum_frequency_hz: float | None
    voiced_coverage: float
    source_frame_count: int
    browser_frame_count: int


@dataclass(frozen=True)
class ContourExtraction:
    browser_frames: list[PitchFrame]
    raw_debug_frames: list[PitchFrame]
    metadata: ContourMetadata


def _interpolate_short_gaps(
    values: npt.NDArray[np.float64], max_gap_frames: int
) -> npt.NDArray[np.float64]:
    result = values.copy()
    index = 0
    while index < len(result):
        if math.isfinite(float(result[index])):
            index += 1
            continue
        gap_start = index
        while index < len(result) and not math.isfinite(float(result[index])):
            index += 1
        gap_end = index
        gap_length = gap_end - gap_start
        if (
            gap_length <= max_gap_frames
            and gap_start > 0
            and gap_end < len(result)
            and math.isfinite(float(result[gap_start - 1]))
            and math.isfinite(float(result[gap_end]))
        ):
            result[gap_start:gap_end] = np.linspace(
                result[gap_start - 1],
                result[gap_end],
                gap_length + 2,
                dtype=np.float64,
            )[1:-1]
    return result


def _median_smooth(values: npt.NDArray[np.float64], window_frames: int) -> npt.NDArray[np.float64]:
    radius = window_frames // 2
    result = values.copy()
    for index, value in enumerate(values):
        if not math.isfinite(float(value)):
            continue
        start = max(0, index - radius)
        end = min(len(values), index + radius + 1)
        neighbors = values[start:end]
        finite_neighbors = neighbors[np.isfinite(neighbors)]
        if finite_neighbors.size:
            result[index] = float(np.median(finite_neighbors))
    return result


def _correct_isolated_octaves(
    values: npt.NDArray[np.float64],
    tolerance_semitones: float = OCTAVE_TOLERANCE_SEMITONES,
) -> npt.NDArray[np.float64]:
    """Correct only one-frame octave errors supported by both neighbours."""
    result = values.copy()
    for index in range(1, len(values) - 1):
        previous = float(values[index - 1])
        current = float(values[index])
        following = float(values[index + 1])
        if not all(math.isfinite(value) for value in (previous, current, following)):
            continue
        if abs(previous - following) > tolerance_semitones:
            continue
        neighborhood = (previous + following) / 2
        octave_offset = current - neighborhood
        if abs(abs(octave_offset) - 12) <= tolerance_semitones:
            result[index] = current - math.copysign(12, octave_offset)
    return result


def _reject_implausible_jumps(
    values: npt.NDArray[np.float64], maximum_jump_semitones: float
) -> npt.NDArray[np.float64]:
    """Reject isolated jumps while preserving sustained expressive/octave movement."""
    result = values.copy()
    for index in range(1, len(values) - 1):
        previous = float(values[index - 1])
        current = float(values[index])
        following = float(values[index + 1])
        if not all(math.isfinite(value) for value in (previous, current, following)):
            continue
        if (
            abs(current - previous) > maximum_jump_semitones
            and abs(current - following) > maximum_jump_semitones
            and abs(previous - following) <= maximum_jump_semitones
        ):
            result[index] = np.nan
    return result


def _downsample_frames(frames: list[PitchFrame], maximum_frames: int) -> list[PitchFrame]:
    if maximum_frames <= 0:
        raise ContourError("browser_max_frames must be positive")
    if len(frames) <= maximum_frames:
        return frames
    indices = np.linspace(0, len(frames) - 1, maximum_frames, dtype=np.int64)
    return [frames[int(index)] for index in np.unique(indices)]


def _confidence(value: float) -> float:
    return min(1.0, max(0.0, value)) if math.isfinite(value) else 0.0


def _frame(
    time_ms: int,
    midi: float,
    confidence: float,
    voiced: bool,
) -> PitchFrame:
    if not voiced or not math.isfinite(midi):
        return PitchFrame(
            time_ms=time_ms,
            frequency_hz=None,
            midi=None,
            confidence=confidence,
            voiced=False,
        )
    return PitchFrame(
        time_ms=time_ms,
        frequency_hz=float(librosa.midi_to_hz(midi)),
        midi=midi,
        confidence=confidence,
        voiced=True,
    )


def analyze_wav(
    input_path: Path,
    session_id: UUID,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> AnalysisPackageV1:
    extraction, duration_seconds = extract_contour(
        input_path,
        ContourConfig(confidence_threshold=confidence_threshold),
    )
    return AnalysisPackageV1(
        session_id=session_id,
        generated_at=datetime.now(UTC),
        duration_seconds=duration_seconds,
        pitch_frames=extraction.browser_frames,
        raw_pitch_frames=extraction.raw_debug_frames,
        sections=[],
    )


def extract_contour(
    input_path: Path,
    config: ContourConfig | None = None,
) -> tuple[ContourExtraction, float]:
    active_config = config or ContourConfig()
    if input_path.suffix.lower() != ".wav":
        raise ContourError("Input must be a WAV file; normalize other formats with FFmpeg first")
    if not input_path.is_file():
        raise ContourError(f"Input WAV does not exist: {input_path}")
    if not 0 <= active_config.confidence_threshold <= 1:
        raise ContourError("Confidence threshold must be between 0 and 1")
    if active_config.median_window_frames <= 0 or active_config.median_window_frames % 2 == 0:
        raise ContourError("median_window_frames must be a positive odd number")
    if active_config.maximum_gap_frames < 0:
        raise ContourError("maximum_gap_frames cannot be negative")

    try:
        audio, _ = librosa.load(input_path, sr=ANALYSIS_SAMPLE_RATE, mono=True)
    except (OSError, RuntimeError, soundfile.LibsndfileError) as error:
        raise ContourError(f"Unable to decode WAV: {error}") from error
    if audio.size == 0:
        raise ContourError("Input WAV contains no audio frames")
    if not np.all(np.isfinite(audio)):
        raise ContourError("Input WAV contains non-finite samples")

    f0, voiced_flags, voiced_probabilities = librosa.pyin(
        audio,
        fmin=MIN_FREQUENCY_HZ,
        fmax=MAX_FREQUENCY_HZ,
        sr=ANALYSIS_SAMPLE_RATE,
        frame_length=FRAME_LENGTH,
        hop_length=HOP_LENGTH,
        fill_na=np.nan,
    )
    if f0.size == 0:
        raise ContourError("Pitch analysis produced no frames")

    probabilities = np.asarray(voiced_probabilities, dtype=np.float64)
    raw_midi = np.full(f0.shape, np.nan, dtype=np.float64)
    finite_f0 = np.isfinite(f0) & (f0 > 0)
    raw_midi[finite_f0] = librosa.hz_to_midi(f0[finite_f0])
    voiced = finite_f0 & np.asarray(voiced_flags, dtype=np.bool_)
    gated_midi = np.where(
        voiced & (probabilities >= active_config.confidence_threshold), raw_midi, np.nan
    )
    octave_corrected = _correct_isolated_octaves(gated_midi)
    jump_cleaned = _reject_implausible_jumps(octave_corrected, active_config.maximum_jump_semitones)
    interpolated = _interpolate_short_gaps(jump_cleaned, active_config.maximum_gap_frames)
    cleaned_midi = _median_smooth(interpolated, active_config.median_window_frames)
    times_ms = np.rint(
        librosa.frames_to_time(
            np.arange(f0.size),
            sr=ANALYSIS_SAMPLE_RATE,
            hop_length=HOP_LENGTH,
        )
        * 1_000
    ).astype(np.int64)

    raw_frames = [
        _frame(
            int(times_ms[index]),
            float(raw_midi[index]),
            _confidence(float(probabilities[index])),
            bool(voiced[index]),
        )
        for index in range(f0.size)
    ]
    cleaned_frames = [
        _frame(
            int(times_ms[index]),
            float(cleaned_midi[index]),
            _confidence(float(probabilities[index])),
            math.isfinite(float(cleaned_midi[index])),
        )
        for index in range(f0.size)
    ]
    browser_frames = _downsample_frames(cleaned_frames, active_config.browser_max_frames)
    voiced_frequencies = [
        frame.frequency_hz
        for frame in cleaned_frames
        if frame.voiced and frame.frequency_hz is not None
    ]
    metadata = ContourMetadata(
        minimum_frequency_hz=min(voiced_frequencies) if voiced_frequencies else None,
        maximum_frequency_hz=max(voiced_frequencies) if voiced_frequencies else None,
        voiced_coverage=len(voiced_frequencies) / len(cleaned_frames),
        source_frame_count=len(cleaned_frames),
        browser_frame_count=len(browser_frames),
    )
    return (
        ContourExtraction(
            browser_frames=browser_frames,
            raw_debug_frames=raw_frames,
            metadata=metadata,
        ),
        float(audio.size / ANALYSIS_SAMPLE_RATE),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a Swaram AnalysisPackageV1 contour from a mono WAV"
    )
    parser.add_argument("input", type=Path, help="input WAV path")
    parser.add_argument("output", type=Path, help="output AnalysisPackageV1 JSON path")
    parser.add_argument("--session-id", type=UUID, required=True)
    parser.add_argument(
        "--confidence-threshold",
        type=float,
        default=DEFAULT_CONFIDENCE_THRESHOLD,
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        package = analyze_wav(args.input, args.session_id, args.confidence_threshold)
    except ContourError as error:
        raise SystemExit(f"Reference contour failed: {error}") from error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(package.model_dump_json(indent=2), encoding="utf-8")
