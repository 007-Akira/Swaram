import { describe, expect, it } from "vitest";

import {
  calculatePhraseMetrics,
  type PhraseComparisonSample,
} from "./phrase-metrics";

function performance(
  reference: readonly number[],
  user: readonly number[],
  options: { shiftMs?: number; confidence?: number } = {},
): PhraseComparisonSample[] {
  return reference.map((referenceMidi, index) => {
    const userMidi = user[index] ?? user.at(-1) ?? referenceMidi;
    return {
      timeMs: index * 100,
      referenceMidi,
      userMidi,
      signedCents: (userMidi - referenceMidi) * 100,
      timeOffsetMs: options.shiftMs ?? 0,
      confidence: options.confidence ?? 0.95,
    };
  });
}

describe("calculatePhraseMetrics", () => {
  it("scores a matching performance highly", () => {
    const metrics = calculatePhraseMetrics(
      performance([60, 60, 62, 64], [60, 60, 62, 64]),
      4,
    );
    expect(metrics.pitch.score).toBe(100);
    expect(metrics.timing.score).toBe(100);
    expect(metrics.contour.score).toBe(100);
    expect(metrics.stability.score).toBe(100);
    expect(metrics.completion.score).toBe(100);
  });

  it("reports shifted onset separately from matching pitch", () => {
    const metrics = calculatePhraseMetrics(
      performance([60, 62, 64], [60, 62, 64], { shiftMs: 150 }),
      3,
    );
    expect(metrics.pitch.score).toBe(100);
    expect(metrics.timing.value).toBe(150);
    expect(metrics.timing.score).toBe(50);
  });

  it.each([
    ["flat", [59.5, 59.5, 59.5], -50],
    ["sharp", [60.5, 60.5, 60.5], 50],
  ] as const)(
    "captures a consistently %s performance",
    (_label, user, cents) => {
      const metrics = calculatePhraseMetrics(
        performance([60, 60, 60], user),
        3,
      );
      expect(metrics.medianSignedCents).toBe(cents);
      expect(metrics.pitch.value).toBe(50);
      expect(metrics.contour.score).toBe(100);
    },
  );

  it("labels missing evidence instead of assigning zero accuracy", () => {
    const metrics = calculatePhraseMetrics([], 10);
    expect(metrics.pitch).toMatchObject({
      score: null,
      sufficient: false,
      coverage: 0,
    });
    expect(metrics.completion.score).toBe(0);
  });

  it("does not over-penalize expected vibrato", () => {
    const metrics = calculatePhraseMetrics(
      performance([60, 60, 60, 60, 60], [60, 60.25, 59.75, 60.25, 59.75]),
      5,
    );
    expect(metrics.stability.score).toBeGreaterThanOrEqual(95);
  });

  it("rewards a matching slide and detects a flat trajectory", () => {
    const reference = [60, 61, 62, 63, 64];
    const slide = calculatePhraseMetrics(performance(reference, reference), 5);
    const flat = calculatePhraseMetrics(
      performance(reference, [60, 60, 60, 60, 60]),
      5,
    );
    expect(slide.contour.score).toBe(100);
    expect(flat.contour.score).toBeLessThan(50);
  });

  it("reduces confidence when coverage is sparse", () => {
    const metrics = calculatePhraseMetrics(
      performance([60, 60, 60], [60, 60, 60]),
      20,
    );
    expect(metrics.pitch.confidence).toBeLessThan(0.2);
    expect(metrics.pitch.sufficient).toBe(true);
    expect(metrics.completion.coverage).toBe(0.15);
  });
});
