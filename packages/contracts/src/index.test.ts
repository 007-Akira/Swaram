import { describe, expect, it } from "vitest";

import {
  ANALYSIS_VERSION,
  isValidJobTransition,
  LyricLineSchema,
  PitchFrameSchema,
  PracticeSessionSchema,
} from "./index.js";

describe("contracts", () => {
  it("uses analysis version 1.0", () => {
    expect(ANALYSIS_VERSION).toBe("1.0");
  });

  it("rejects malformed timestamps", () => {
    expect(() =>
      PracticeSessionSchema.parse({
        id: "f88c2a2b-1d5a-4c27-b4b9-38c320a14821",
        owner_id: "0d39c34b-7bde-4da2-a7ce-1466652dc34f",
        title: "പരിശീലനം",
        created_at: "yesterday",
        expires_at: "2026-07-27T10:00:00Z",
      }),
    ).toThrow();
  });

  it.each([
    { frequency_hz: -1, confidence: 0.5 },
    { frequency_hz: 440, confidence: -0.1 },
    { frequency_hz: 440, confidence: 1.1 },
  ])("rejects invalid pitch data", ({ frequency_hz, confidence }) => {
    expect(() =>
      PitchFrameSchema.parse({
        time_ms: 0,
        frequency_hz,
        midi: 69,
        confidence,
        voiced: true,
      }),
    ).toThrow();
  });

  it("preserves unvoiced regions explicitly", () => {
    expect(
      PitchFrameSchema.parse({
        time_ms: 100,
        frequency_hz: null,
        midi: null,
        confidence: 0.1,
        voiced: false,
      }),
    ).toEqual({
      time_ms: 100,
      frequency_hz: null,
      midi: null,
      confidence: 0.1,
      voiced: false,
    });
  });

  it("enforces durable PostgreSQL job transitions", () => {
    expect(isValidJobTransition("queued", "claimed")).toBe(true);
    expect(isValidJobTransition("claimed", "running")).toBe(true);
    expect(isValidJobTransition("succeeded", "running")).toBe(false);
  });

  it("normalizes Malayalam lyric text to NFC", () => {
    const text = "കൊ";
    const line = LyricLineSchema.parse({
      id: "a72a7e92-0bf0-485c-b1fd-52091d024d04",
      text,
      start_seconds: 0,
      end_seconds: 1,
    });
    expect(line.text).toBe(text.normalize("NFC"));
  });
});
