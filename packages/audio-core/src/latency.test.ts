import { describe, expect, it } from "vitest";

import {
  applyLatencyOffset,
  assertUncorrectedSongTime,
  estimateLatencyOffsetMs,
  nudgeLatencyOffsetMs,
} from "./latency";

describe("device latency", () => {
  it("combines browser output estimates", () => {
    expect(
      estimateLatencyOffsetMs({
        baseLatencySeconds: 0.01,
        outputLatencySeconds: 0.025,
      }),
    ).toBe(35);
  });

  it("uses half a measured round trip when it is stronger evidence", () => {
    expect(
      estimateLatencyOffsetMs({
        baseLatencySeconds: 0.01,
        detectedRoundTripMs: 120,
      }),
    ).toBe(60);
  });

  it("bounds guided manual nudges", () => {
    expect(nudgeLatencyOffsetMs(50, 20)).toBe(70);
    expect(nudgeLatencyOffsetMs(50, -500)).toBe(0);
    expect(nudgeLatencyOffsetMs(900, 500)).toBe(1_000);
  });

  it("applies latency once and rejects corrected input", () => {
    const corrected = applyLatencyOffset(1_000, 80);
    expect(corrected.comparisonTimeMs).toBe(920);
    expect(() => assertUncorrectedSongTime(corrected)).toThrow(
      "already been applied",
    );
    expect(() => {
      const raw: number | typeof corrected = 1_000;
      assertUncorrectedSongTime(raw);
    }).not.toThrow();
  });
});
