from __future__ import annotations

import argparse
import json
import math
import platform
import statistics
import tempfile
import time
import wave
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from swaram_worker.reference_contour import ContourConfig, extract_contour

SAMPLE_RATE = 22_050


@dataclass(frozen=True)
class AccuracyMetrics:
    median_absolute_cents: float
    mean_absolute_cents: float
    voiced_unvoiced_accuracy: float
    octave_error_rate: float
    usable_contour_coverage: float
    evaluated_voiced_frames: int
    evaluated_total_frames: int


@dataclass(frozen=True)
class RuntimeMetric:
    duration_seconds: float
    elapsed_seconds: float
    realtime_factor: float


class EvaluationFrame(Protocol):
    time_ms: int
    voiced: bool
    frequency_hz: float | None


def _expected_frequency(time_seconds: float) -> float | None:
    if 1 <= time_seconds < 3:
        return 440.0
    if 4 <= time_seconds <= 6:
        return 220.0 * 2 ** ((time_seconds - 4) / 2)
    return None


def generated_evaluation_signal() -> np.ndarray:
    duration = 6
    times = np.arange(duration * SAMPLE_RATE, dtype=np.float64) / SAMPLE_RATE
    signal = np.zeros_like(times)
    phase = 0.0
    for index, point in enumerate(times):
        frequency = _expected_frequency(float(point))
        if frequency is not None:
            phase += 2 * math.pi * frequency / SAMPLE_RATE
            signal[index] = 0.4 * math.sin(phase)
    return signal.astype(np.float32)


def _write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = np.clip(samples * 32767, -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm.tobytes())


def calculate_accuracy(frames: Sequence[EvaluationFrame]) -> AccuracyMetrics:
    cents_errors: list[float] = []
    correct_vuv = 0
    octave_errors = 0
    expected_voiced_frames = 0
    for frame in frames:
        time_ms = frame.time_ms
        detected = frame.voiced
        frequency = frame.frequency_hz
        expected = _expected_frequency(time_ms / 1000)
        expected_voiced = expected is not None
        correct_vuv += detected == expected_voiced
        if expected is None:
            continue
        expected_voiced_frames += 1
        if not detected or frequency is None:
            continue
        cents = 1200 * math.log2(float(frequency) / expected)
        cents_errors.append(abs(cents))
        if abs(cents) >= 600:
            octave_errors += 1
    total = len(frames)
    return AccuracyMetrics(
        median_absolute_cents=round(statistics.median(cents_errors), 3),
        mean_absolute_cents=round(statistics.fmean(cents_errors), 3),
        voiced_unvoiced_accuracy=round(correct_vuv / total, 4),
        octave_error_rate=round(octave_errors / max(1, len(cents_errors)), 4),
        usable_contour_coverage=round(len(cents_errors) / max(1, expected_voiced_frames), 4),
        evaluated_voiced_frames=expected_voiced_frames,
        evaluated_total_frames=total,
    )


def _runtime_benchmark(directory: Path, durations: Sequence[float]) -> list[RuntimeMetric]:
    results: list[RuntimeMetric] = []
    for duration in durations:
        times = np.arange(round(duration * SAMPLE_RATE), dtype=np.float64) / SAMPLE_RATE
        samples = (0.4 * np.sin(2 * math.pi * 440 * times)).astype(np.float32)
        path = directory / f"runtime-{duration:g}s.wav"
        _write_wav(path, samples)
        started = time.perf_counter()
        extract_contour(path, ContourConfig(confidence_threshold=0.1))
        elapsed = time.perf_counter() - started
        results.append(
            RuntimeMetric(
                duration_seconds=duration,
                elapsed_seconds=round(elapsed, 4),
                realtime_factor=round(elapsed / duration, 4),
            )
        )
    return results


def evaluate(durations: Sequence[float] = (5, 15, 30)) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="swaram-evaluation-") as temporary:
        directory = Path(temporary)
        fixture = directory / "tone-glide-vuv.wav"
        _write_wav(fixture, generated_evaluation_signal())
        contour, _duration = extract_contour(fixture, ContourConfig(confidence_threshold=0.1))
        accuracy = calculate_accuracy(contour.browser_frames)
        runtime = _runtime_benchmark(directory, durations)
    return {
        "evaluation_version": "1.0",
        "fixture": "generated tone/glide/silence; no copyrighted media",
        "hardware": {
            "platform": platform.platform(),
            "processor": platform.processor() or "not reported",
            "python": platform.python_version(),
            "logical_cpu_count": __import__("os").cpu_count(),
        },
        "f0_and_voicing": asdict(accuracy),
        "pyin_runtime": [asdict(item) for item in runtime],
        "not_measured": [
            "manually checked Malayalam vocal segments",
            "physical browser microphone latency",
            "five-minute physical playback synchronization drift",
            "HTDemucs contour coverage on authorized songs",
        ],
    }


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run Swaram synthetic F0 evaluation")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    payload = json.dumps(evaluate(), ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(f"{payload}\n", encoding="utf-8")
    else:
        print(payload)


if __name__ == "__main__":
    main()
