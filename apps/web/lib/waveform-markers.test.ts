import { describe, expect, it } from "vitest";

import { newLine } from "./lyric-editor";
import { linesToMarkers, updateLineFromMarker } from "./waveform-markers";

describe("waveform lyric marker mapping", () => {
  it("maps only valid timed lyric rows and preserves identity", () => {
    const lines = [
      { ...newLine("ഒന്ന്"), id: "one", start_ms: 1000, end_ms: 2000 },
      newLine(),
      { ...newLine("രണ്ട്"), id: "two", start_ms: 2000, end_ms: 3000 },
    ];
    expect(linesToMarkers(lines)).toEqual([
      {
        lineId: "one",
        lineIndex: 0,
        startSeconds: 1,
        endSeconds: 2,
        label: "ഒന്ന്",
      },
      {
        lineId: "two",
        lineIndex: 2,
        startSeconds: 2,
        endSeconds: 3,
        label: "രണ്ട്",
      },
    ]);
  });

  it("updates a marker without allowing it to cross neighbours", () => {
    const lines = [
      { ...newLine("ഒന്ന്"), id: "one", start_ms: 1000, end_ms: 2000 },
      { ...newLine("രണ്ട്"), id: "two", start_ms: 2000, end_ms: 3000 },
    ];
    expect(updateLineFromMarker(lines, "two", 2.1)[1]?.start_ms).toBe(2100);
    expect(() => updateLineFromMarker(lines, "two", 0.9)).toThrow();
  });
});
