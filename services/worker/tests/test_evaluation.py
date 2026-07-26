from types import SimpleNamespace

from swaram_worker.evaluation import calculate_accuracy, generated_evaluation_signal


def test_generated_fixture_contains_only_bounded_synthetic_audio() -> None:
    signal = generated_evaluation_signal()
    assert len(signal) == 6 * 22_050
    assert signal.max() <= 0.4
    assert signal.min() >= -0.4
    assert (signal[:22_050] == 0).all()


def test_accuracy_reports_voicing_cents_and_octave_errors() -> None:
    frames = [
        SimpleNamespace(time_ms=500, voiced=False, frequency_hz=None),
        SimpleNamespace(time_ms=1500, voiced=True, frequency_hz=440),
        SimpleNamespace(time_ms=2000, voiced=True, frequency_hz=880),
        SimpleNamespace(time_ms=3500, voiced=True, frequency_hz=220),
    ]
    metrics = calculate_accuracy(frames)
    assert metrics.voiced_unvoiced_accuracy == 0.75
    assert metrics.octave_error_rate == 0.5
    assert metrics.median_absolute_cents == 600
    assert metrics.usable_contour_coverage == 1
