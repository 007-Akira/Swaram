import { describe, expect, it } from "vitest";

import { applyLatencyOffset } from "./latency";
import {
  comparePitchToReferenceWindow,
  type TimedPitchObservation,
} from "./windowed-comparison";

const frame = (
  timeMs: number,
  frequencyHz: number | null,
  confidence = 0.95,
  voiced = frequencyHz !== null,
): TimedPitchObservation => ({
  timeMs,
  frequencyHz,
  confidence,
  voiced,
});

describe("comparePitchToReferenceWindow", () => {
  it("chooses the best plausible point and reports timing direction", () => {
    const result = comparePitchToReferenceWindow(
      [frame(900, 400), frame(1_050, 440), frame(1_100, 460)],
      frame(0, 440),
      applyLatencyOffset(1_100, 100),
    );
    expect(result).toMatchObject({
      valid: true,
      referenceTimeMs: 1_050,
      timeOffsetMs: 50,
      signedCents: 0,
      confidence: 0.95,
    });
  });

  it("keeps configurable early and late tolerance bounded", () => {
    const reference = [frame(700, 440), frame(1_300, 440)];
    expect(
      comparePitchToReferenceWindow(
        reference,
        frame(0, 440),
        applyLatencyOffset(1_000, 0),
        { earlyToleranceMs: 100, lateToleranceMs: 100 },
      ),
    ).toMatchObject({ valid: false, reason: "missing-reference" });
  });

  it.each([
    [
      "user-unvoiced",
      { frequencyHz: null, confidence: 0, voiced: false },
      [frame(1_000, 440)],
    ],
    [
      "low-confidence",
      { frequencyHz: 440, confidence: 0.1, voiced: true },
      [frame(1_000, 440)],
    ],
    [
      "non-positive-frequency",
      { frequencyHz: 0, confidence: 1, voiced: true },
      [frame(1_000, 440)],
    ],
    [
      "consonant-transient",
      { frequencyHz: 440, confidence: 1, voiced: true, transient: true },
      [frame(1_000, 440)],
    ],
    [
      "reference-unvoiced",
      { frequencyHz: 440, confidence: 1, voiced: true },
      [frame(1_000, null)],
    ],
  ] as const)("excludes %s", (reason, user, reference) => {
    expect(
      comparePitchToReferenceWindow(
        reference,
        user,
        applyLatencyOffset(1_000, 0),
      ),
    ).toMatchObject({ valid: false, reason });
  });

  it("labels octave-up and octave-down mismatches separately", () => {
    const reference = [frame(1_000, 220)];
    const up = comparePitchToReferenceWindow(
      reference,
      frame(0, 440),
      applyLatencyOffset(1_000, 0),
    );
    const down = comparePitchToReferenceWindow(
      [frame(1_000, 440)],
      frame(0, 220),
      applyLatencyOffset(1_000, 0),
    );
    expect(up.valid && up.probableOctaveMismatch).toBe("up");
    expect(down.valid && down.probableOctaveMismatch).toBe("down");
  });

  it("does not mutate or latency-correct an already corrected timestamp", () => {
    const corrected = applyLatencyOffset(1_080, 80);
    const result = comparePitchToReferenceWindow(
      [frame(1_000, 440)],
      frame(0, 440),
      corrected,
    );
    expect(result.valid && result.timeOffsetMs).toBe(0);
    expect(corrected.comparisonTimeMs).toBe(1_000);
  });
});
