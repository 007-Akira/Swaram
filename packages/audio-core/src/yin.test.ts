import { describe, expect, it } from "vitest";

import { detectPitchYin } from "./yin";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 4_096;

function sine(frequencyHz: number, amplitude = 0.7): Float32Array {
  return Float32Array.from(
    { length: FRAME_SIZE },
    (_, index) =>
      amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE),
  );
}

function seededNoise(amplitude: number): Float32Array {
  let state = 0x12345678;
  return Float32Array.from({ length: FRAME_SIZE }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return amplitude * (state / 0xffffffff - 0.5) * 2;
  });
}

function add(left: Float32Array, right: Float32Array): Float32Array {
  return Float32Array.from(left, (sample, index) => {
    return sample + (right[index] ?? 0);
  });
}

describe("detectPitchYin", () => {
  it.each([
    ["A3", 220],
    ["A4", 440],
    ["C4", 261.6256],
  ])("detects %s", (_, expectedFrequency) => {
    const result = detectPitchYin(sine(expectedFrequency), SAMPLE_RATE);
    expect(result.voiced).toBe(true);
    expect(result.frequencyHz).toBeCloseTo(expectedFrequency, 0);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("does not assign a note to silence", () => {
    expect(detectPitchYin(new Float32Array(FRAME_SIZE), SAMPLE_RATE)).toEqual({
      frequencyHz: null,
      confidence: 0,
      voiced: false,
    });
  });

  it("does not assign a note to deterministic broadband noise", () => {
    expect(detectPitchYin(seededNoise(0.5), SAMPLE_RATE).voiced).toBe(false);
  });

  it("tracks a tone mixed with moderate noise", () => {
    const result = detectPitchYin(
      add(sine(440), seededNoise(0.08)),
      SAMPLE_RATE,
    );
    expect(result.voiced).toBe(true);
    expect(result.frequencyHz).toBeCloseTo(440, 0);
  });

  it("rejects frames too short for the configured range", () => {
    expect(() =>
      detectPitchYin(
        Float32Array.from({ length: 16 }, () => 0.5),
        SAMPLE_RATE,
        {
          minFrequencyHz: 80,
        },
      ),
    ).toThrow(/too short/);
  });
});
