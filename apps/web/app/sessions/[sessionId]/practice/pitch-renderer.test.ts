import { describe, expect, it } from "vitest";

import {
  createPitchViewport,
  midiToY,
  selectContourWindow,
  timeToX,
} from "./pitch-renderer";

describe("pitch renderer transforms", () => {
  it("maps time and MIDI into responsive viewport coordinates", () => {
    const viewport = createPitchViewport(5_000, 800, 400, 10_000, 40, 80);
    expect(timeToX(viewport.startMs, viewport)).toBe(0);
    expect(timeToX(viewport.endMs, viewport)).toBe(800);
    expect(midiToY(80, viewport)).toBe(0);
    expect(midiToY(40, viewport)).toBe(400);
  });

  it("selects only the visible contour plus continuity neighbours", () => {
    const points = Array.from({ length: 10_000 }, (_, index) => ({
      timeMs: index * 10,
      midi: 60,
      voiced: true,
    }));
    const selected = selectContourWindow(points, 20_000, 30_000);
    expect(selected.length).toBeLessThan(1_010);
    expect(selected[0]?.timeMs).toBe(19_990);
    expect(selected.at(-1)?.timeMs).toBe(30_000);
  });

  it("preserves explicit unvoiced gaps in the selected window", () => {
    const points = [
      { timeMs: 0, midi: 60, voiced: true },
      { timeMs: 100, midi: null, voiced: false },
      { timeMs: 200, midi: 62, voiced: true },
    ];
    expect(selectContourWindow(points, 0, 200)).toEqual(points);
  });
});
