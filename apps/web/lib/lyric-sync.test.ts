import { describe, expect, it } from "vitest";

import { newLine } from "./lyric-editor";
import {
  deriveEndTimes,
  markLineAt,
  nudgeLine,
  resetTimings,
} from "./lyric-sync";

describe("line synchronization", () => {
  it("marks ordered starts and derives ends from one song duration", () => {
    let lines = [newLine("ഒന്ന്"), newLine("രണ്ട്"), newLine("മൂന്ന്")];
    lines = markLineAt(lines, 0, 1000.4, 10_000);
    lines = markLineAt(lines, 1, 3000, 10_000);
    lines = markLineAt(lines, 2, 7000, 10_000);
    expect(lines.map((line) => [line.start_ms, line.end_ms])).toEqual([
      [1000, 3000],
      [3000, 7000],
      [7000, 10_000],
    ]);
  });

  it("rejects crossing markers and supports nudge/reset", () => {
    const lines = deriveEndTimes(
      [
        { ...newLine("ഒന്ന്"), start_ms: 1000 },
        { ...newLine("രണ്ട്"), start_ms: 2000 },
      ],
      3000,
    );
    expect(() => nudgeLine(lines, 1, -1100, 3000)).toThrow();
    expect(nudgeLine(lines, 1, 100, 3000)[1]?.start_ms).toBe(2100);
    expect(resetTimings(lines).every((line) => line.start_ms === null)).toBe(
      true,
    );
  });
});
