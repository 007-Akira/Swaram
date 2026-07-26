import { describe, expect, it } from "vitest";

import {
  assessPlaybackLeakage,
  generateCalibrationChirp,
  measurePeakCorrelation,
} from "./leakage-calibration";

function delayed(signal: Float32Array, delay: number, gain = 1): Float32Array {
  const output = new Float32Array(signal.length + delay);
  for (let index = 0; index < signal.length; index += 1) {
    output[index + delay] = (signal[index] ?? 0) * gain;
  }
  return output;
}

describe("leakage calibration", () => {
  it("generates a bounded original chirp", () => {
    const signal = generateCalibrationChirp(8_000, 0.25);
    expect(signal).toHaveLength(2_000);
    expect(Math.max(...signal)).toBeLessThanOrEqual(0.25);
    expect(Math.min(...signal)).toBeGreaterThanOrEqual(-0.25);
  });

  it("finds a delayed correlated return", () => {
    const signal = generateCalibrationChirp(8_000, 0.05);
    const result = measurePeakCorrelation(
      signal,
      delayed(signal, 80, 0.2),
      200,
    );
    expect(result.lagSamples).toBe(80);
    expect(result.correlation).toBeGreaterThan(0.99);
  });

  it("blocks high leakage unless the testing override is explicit", () => {
    const signal = generateCalibrationChirp(8_000, 0.05);
    const captured = delayed(signal, 40, 0.5);
    expect(assessPlaybackLeakage(signal, captured, 8_000)).toMatchObject({
      level: "high",
      canContinue: false,
    });
    expect(
      assessPlaybackLeakage(signal, captured, 8_000, true).canContinue,
    ).toBe(true);
  });

  it("does not mistake unrelated microphone energy for playback leakage", () => {
    const signal = generateCalibrationChirp(8_000, 0.05);
    const captured = Float32Array.from({ length: signal.length }, (_, index) =>
      index % 2 === 0 ? 0.02 : -0.02,
    );
    const result = assessPlaybackLeakage(signal, captured, 8_000);
    expect(result.level).toBe("low");
    expect(result.canContinue).toBe(true);
  });

  it("reports silence as inconclusive instead of claiming headphones", () => {
    const signal = generateCalibrationChirp(8_000, 0.05);
    const result = assessPlaybackLeakage(
      signal,
      new Float32Array(signal.length),
      8_000,
    );
    expect(result.level).toBe("inconclusive");
    expect(result.peakCorrelation).toBe(0);
  });
});
