import { describe, expect, it } from "vitest";

import {
  ANALYSIS_VERSION,
  AnalysisPackageV1Schema,
  isValidJobTransition,
  LyricLineSchema,
  parseLyricsInput,
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

  it("validates compact public analysis metadata without raw debug frames", () => {
    expect(
      AnalysisPackageV1Schema.parse({
        analysis_version: "1.0",
        session_id: "f88c2a2b-1d5a-4c27-b4b9-38c320a14821",
        generated_at: "2026-07-26T10:00:00Z",
        duration_seconds: 1,
        input_checksum_sha256: "a".repeat(64),
        pipeline_version: "1.0",
        model_identifier: "htdemucs",
        pitch_range: {
          minimum_frequency_hz: 220,
          maximum_frequency_hz: 440,
        },
        voiced_coverage: 0.5,
        estimated_tempo_bpm: null,
        tempo_confidence: 0,
        tempo_limitation: "Low confidence.",
        beat_timestamps_ms: [],
        energy_envelope: [],
        pitch_frames: [],
        sections: [],
      }),
    ).toBeTruthy();
  });

  it("parses Malayalam TXT, LRC, and SRT without losing repetition or stanzas", () => {
    const plain = parseLyricsInput("മഴവില്ല്\n\nകൺമണി\nകൺമണി", "txt");
    expect(plain[1]?.is_stanza_break).toBe(true);
    expect(plain[2]?.text_nfc).toBe(plain[3]?.text_nfc);
    expect(parseLyricsInput("[00:34.73]മഴവില്ല്", "lrc")[0]?.start_ms).toBe(
      34_730,
    );
    expect(
      parseLyricsInput(
        "1\n00:00:01,250 --> 00:00:02,500\nകൺമണി",
        "srt",
      )[0],
    ).toMatchObject({ start_ms: 1250, end_ms: 2500 });
  });
});
