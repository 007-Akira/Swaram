import { describe, expect, it } from "vitest";
import type { AnalysisPackageV1 } from "@swaram/contracts";

import { buildAttemptPayload } from "./build-attempt";

describe("buildAttemptPayload", () => {
  it("creates privacy-safe versioned phrase data without microphone audio", () => {
    const analysis: AnalysisPackageV1 = {
      analysis_version: "1.0",
      session_id: "00000000-0000-4000-8000-000000000000",
      generated_at: "2026-07-26T00:00:00Z",
      duration_seconds: 2,
      pitch_frames: [
        {
          time_ms: 0,
          frequency_hz: 440,
          midi: 69,
          confidence: 1,
          voiced: true,
        },
        {
          time_ms: 500,
          frequency_hz: 440,
          midi: 69,
          confidence: 1,
          voiced: true,
        },
        {
          time_ms: 900,
          frequency_hz: 440,
          midi: 69,
          confidence: 1,
          voiced: true,
        },
      ],
      input_checksum_sha256: "a".repeat(64),
      pipeline_version: "1.0",
      model_identifier: "test",
      pitch_range: {
        minimum_frequency_hz: 440,
        maximum_frequency_hz: 440,
      },
      voiced_coverage: 1,
      estimated_tempo_bpm: null,
      tempo_confidence: 0,
      tempo_limitation: "test fixture",
      beat_timestamps_ms: [],
      energy_envelope: [],
      sections: [],
    };
    const payload = buildAttemptPayload(
      analysis,
      [
        {
          id: "00000000-0000-4000-8000-000000000001",
          text: "മഴ",
          start_ms: 0,
          end_ms: 1_000,
          is_stanza_break: false,
        },
      ],
      [0, 500, 900].map((timeMs) => ({
        timeMs,
        referenceMidi: 69,
        userMidi: 69,
        signedCents: 0,
        timeOffsetMs: 0,
        confidence: 1,
      })),
      {
        mode: "instrumental",
        speed: 1,
        latencyOffsetMs: 30,
        profile: "intermediate",
      },
    );
    expect(payload.overall_score).toBe(100);
    expect(payload.phrases).toHaveLength(1);
    expect(payload).not.toHaveProperty("raw_microphone_audio");
  });
});
