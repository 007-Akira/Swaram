import argparse
import math
from collections.abc import Sequence
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


class ContourError(ValueError):
    pass


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
    if input_path.suffix.lower() != ".wav":
        raise ContourError("Input must be a WAV file; normalize other formats with FFmpeg first")
    if not input_path.is_file():
        raise ContourError(f"Input WAV does not exist: {input_path}")
    if not 0 <= confidence_threshold <= 1:
        raise ContourError("Confidence threshold must be between 0 and 1")

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
    gated_midi = np.where(voiced & (probabilities >= confidence_threshold), raw_midi, np.nan)
    interpolated = _interpolate_short_gaps(gated_midi, MAX_INTERPOLATED_GAP_FRAMES)
    cleaned_midi = _median_smooth(interpolated, MEDIAN_WINDOW_FRAMES)
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
    return AnalysisPackageV1(
        session_id=session_id,
        generated_at=datetime.now(UTC),
        duration_seconds=float(audio.size / ANALYSIS_SAMPLE_RATE),
        pitch_frames=cleaned_frames,
        raw_pitch_frames=raw_frames,
        sections=[],
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
