import { describe, expect, it } from "vitest";

import { LivePitchProcessor } from "./live-pitch";

const voiced = (frequencyHz: number, confidence = 0.95) => ({
  frequencyHz,
  confidence,
  voiced: true,
});

function harmonicFixture(
  frequencyHz: number,
  sampleRate: number,
  length: number,
): Float32Array {
  let seed = 17;
  return Float32Array.from({ length }, (_, index) => {
    seed = (seed * 48_271) % 2_147_483_647;
    const noise = (seed / 2_147_483_647 - 0.5) * 0.01;
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
    return Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.12 + noise;
  });
}

describe("LivePitchProcessor", () => {
  it("gates low RMS, confidence, and out-of-range observations", () => {
    const processor = new LivePitchProcessor();
    expect(processor.processObservation(voiced(440), 0.001, 10).voiced).toBe(
      false,
    );
    expect(processor.processObservation(voiced(440, 0.4), 0.1, 20).voiced).toBe(
      false,
    );
    expect(processor.processObservation(voiced(1_200), 0.1, 30).voiced).toBe(
      false,
    );
  });

  it("uses a small median window without removing gradual movement", () => {
    const processor = new LivePitchProcessor({ debug: true });
    processor.processObservation(voiced(440), 0.1, 0);
    processor.processObservation(voiced(466), 0.1, 20);
    const slide = processor.processObservation(voiced(494), 0.1, 40);
    expect(slide.frequencyHz).toBe(466);
    expect(slide.debug?.rawFrequencyHz).toBe(494);
  });

  it("rejects one isolated octave spike but accepts a repeated change", () => {
    const processor = new LivePitchProcessor();
    processor.processObservation(voiced(440), 0.1, 0);
    const spike = processor.processObservation(voiced(880), 0.1, 20);
    const confirmed = processor.processObservation(voiced(880), 0.1, 40);
    expect(spike.frequencyHz).toBe(440);
    expect(confirmed.frequencyHz).toBe(880);
  });

  it("emits unvoiced state and resets smoothing across rests", () => {
    const processor = new LivePitchProcessor();
    processor.processObservation(voiced(440), 0.1, 0);
    expect(
      processor.processObservation(
        { frequencyHz: null, confidence: 0, voiced: false },
        0,
        20,
      ),
    ).toMatchObject({ voiced: false, frequencyHz: null, timeMs: 20 });
    expect(
      processor.processObservation(voiced(523.25), 0.1, 40).frequencyHz,
    ).toBeCloseTo(523.25);
  });

  it("tracks a captured-style harmonic fixture with an audio-clock timestamp", () => {
    const processor = new LivePitchProcessor();
    const frame = processor.process(
      harmonicFixture(220, 8_000, 2_048),
      8_000,
      1_234,
    );
    expect(frame.voiced).toBe(true);
    expect(frame.frequencyHz).toBeCloseTo(220, 0);
    expect(frame.timeMs).toBe(1_234);
  });
});
