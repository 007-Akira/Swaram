import { describe, expect, it } from "vitest";

import { calculatePhraseMetrics } from "./phrase-metrics";
import {
  calculateWeightedScore,
  DEFAULT_SCORE_WEIGHTS,
  SCORE_VERSION,
} from "./weighted-score";

const samples = Array.from({ length: 10 }, (_, index) => ({
  timeMs: index * 100,
  referenceMidi: 60,
  userMidi: 60.4,
  signedCents: 40,
  timeOffsetMs: 60,
  confidence: 0.9,
}));

describe("calculateWeightedScore", () => {
  it("uses requested defaults and persists score metadata", () => {
    const result = calculateWeightedScore(calculatePhraseMetrics(samples, 10));
    expect(DEFAULT_SCORE_WEIGHTS).toEqual({
      pitch: 0.45,
      timing: 0.2,
      contour: 0.2,
      stability: 0.1,
      completion: 0.05,
    });
    expect(result.scoringVersion).toBe(SCORE_VERSION);
    expect(result.toleranceProfile).toBe("intermediate");
    expect(result.notice).toMatch(/not medical/);
  });

  it("renormalizes missing components instead of treating them as zero", () => {
    const sparse = calculatePhraseMetrics(samples.slice(0, 1), 10);
    const result = calculateWeightedScore(sparse);
    expect(result.components.pitch).toBeNull();
    expect(result.components.timing).not.toBeNull();
    expect(result.normalizedWeights.pitch).toBe(0);
    expect(result.overall).not.toBe(0);
  });

  it("makes beginner tolerances no stricter than intermediate", () => {
    const metrics = calculatePhraseMetrics(samples, 10);
    const beginner = calculateWeightedScore(metrics, "beginner");
    const intermediate = calculateWeightedScore(metrics, "intermediate");
    expect(beginner.overall ?? 0).toBeGreaterThanOrEqual(
      intermediate.overall ?? 0,
    );
  });

  it("keeps scores within 0..100 across generated metric inputs", () => {
    let seed = 123_456;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    for (let run = 0; run < 500; run += 1) {
      const generated = Array.from(
        { length: 3 + Math.floor(random() * 20) },
        (_, index) => {
          const referenceMidi = 48 + random() * 30;
          const signedCents = (random() - 0.5) * 1_000;
          return {
            timeMs: index * 50,
            referenceMidi,
            userMidi: referenceMidi + signedCents / 100,
            signedCents,
            timeOffsetMs: (random() - 0.5) * 1_000,
            confidence: random(),
          };
        },
      );
      const result = calculateWeightedScore(
        calculatePhraseMetrics(generated, 1 + Math.floor(random() * 30)),
        random() > 0.5 ? "beginner" : "intermediate",
      );
      if (result.overall !== null) {
        expect(result.overall).toBeGreaterThanOrEqual(0);
        expect(result.overall).toBeLessThanOrEqual(100);
      }
      for (const score of Object.values(result.components)) {
        if (score !== null) {
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
