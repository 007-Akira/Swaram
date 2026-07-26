import { describe, expect, it } from "vitest";

import { comparePitchFrames, type PitchObservation } from "./comparison";

const reference: PitchObservation = {
  frequencyHz: 440,
  confidence: 0.95,
  voiced: true,
};

function atCents(cents: number): PitchObservation {
  return {
    frequencyHz: 440 * 2 ** (cents / 1_200),
    confidence: 0.95,
    voiced: true,
  };
}

describe("comparePitchFrames", () => {
  it("classifies an exact match as excellent", () => {
    expect(comparePitchFrames(reference, atCents(0))).toMatchObject({
      valid: true,
      signedCents: 0,
      absoluteCents: 0,
      classification: "excellent",
    });
  });

  it("returns a positive signed error for a sharp note", () => {
    const result = comparePitchFrames(reference, atCents(40));
    expect(result.valid && result.signedCents).toBeCloseTo(40, 6);
    expect(result.valid && result.classification).toBe("good");
  });

  it("returns a negative signed error for a flat note", () => {
    const result = comparePitchFrames(reference, atCents(-70));
    expect(result.valid && result.signedCents).toBeCloseTo(-70, 6);
    expect(result.valid && result.classification).toBe("close");
  });

  it("classifies an octave mismatch as off-pitch", () => {
    const result = comparePitchFrames(reference, atCents(1_200));
    expect(result.valid && result.absoluteCents).toBeCloseTo(1_200, 6);
    expect(result.valid && result.classification).toBe("off-pitch");
  });

  it.each([
    ["missing-reference", null, atCents(0)],
    [
      "reference-unvoiced",
      { frequencyHz: null, confidence: 0, voiced: false },
      atCents(0),
    ],
    [
      "user-unvoiced",
      reference,
      { frequencyHz: null, confidence: 0, voiced: false },
    ],
    [
      "low-confidence",
      reference,
      { frequencyHz: 440, confidence: 0.1, voiced: true },
    ],
    [
      "non-positive-frequency",
      reference,
      { frequencyHz: 0, confidence: 1, voiced: true },
    ],
  ] as const)("rejects %s frames", (reason, referenceFrame, userFrame) => {
    expect(comparePitchFrames(referenceFrame, userFrame)).toEqual({
      valid: false,
      signedCents: null,
      absoluteCents: null,
      classification: null,
      reason,
    });
  });
});
