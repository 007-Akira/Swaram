import { z } from "zod";

export const ANALYSIS_VERSION = "1.0" as const;
const timestamp = z.string().datetime({ offset: true });
const id = z.string().uuid();
const nonNegative = z.number().finite().nonnegative();
const confidence = z.number().finite().min(0).max(1);

export const PracticeSessionSchema = z
  .object({
    id,
    owner_id: id,
    title: z.string().trim().min(1).max(200),
    created_at: timestamp,
    expires_at: timestamp,
  })
  .strict()
  .refine(
    (session) =>
      Date.parse(session.expires_at) > Date.parse(session.created_at),
    { message: "expires_at must be later than created_at" },
  );
export type PracticeSession = z.infer<typeof PracticeSessionSchema>;

export const UploadedAssetSchema = z
  .object({
    id,
    session_id: id,
    kind: z.enum(["audio", "lyrics"]),
    filename: z.string().trim().min(1).max(255),
    content_type: z.string().trim().min(1),
    size_bytes: z.number().int().nonnegative(),
    created_at: timestamp,
  })
  .strict();
export type UploadedAsset = z.infer<typeof UploadedAssetSchema>;

export const JobStateSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type JobState = z.infer<typeof JobStateSchema>;

const jobTransitions: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: ["claimed", "cancelled"],
  claimed: ["queued", "running", "failed", "cancelled"],
  running: ["queued", "succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["queued"],
  cancelled: [],
};

export function isValidJobTransition(
  previous: JobState,
  nextState: JobState,
): boolean {
  return jobTransitions[previous].includes(nextState);
}

export const ProcessingJobSchema = z
  .object({
    id,
    session_id: id,
    state: JobStateSchema,
    attempts: z.number().int().nonnegative(),
    created_at: timestamp,
    updated_at: timestamp,
    error_code: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ProcessingJob = z.infer<typeof ProcessingJobSchema>;

export const LyricLineSchema = z
  .object({
    id,
    text: z
      .string()
      .min(1)
      .transform((text) => text.normalize("NFC")),
    start_seconds: nonNegative,
    end_seconds: nonNegative,
  })
  .strict()
  .refine((line) => line.end_seconds > line.start_seconds, {
    message: "end_seconds must be greater than start_seconds",
  });
export type LyricLine = z.infer<typeof LyricLineSchema>;

export const ParsedLyricLineSchema = z
  .object({
    text_nfc: z.string(),
    start_ms: z.number().int().nonnegative().nullable(),
    end_ms: z.number().int().positive().nullable(),
    is_stanza_break: z.boolean(),
  })
  .strict()
  .refine(
    (line) =>
      line.start_ms === null ||
      line.end_ms === null ||
      line.end_ms > line.start_ms,
    { message: "lyric end must follow start" },
  );
export type ParsedLyricLine = z.infer<typeof ParsedLyricLineSchema>;
export type LyricInputFormat = "txt" | "lrc" | "srt";

export class LyricParseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function fractionMilliseconds(value: string | undefined): number {
  if (value === undefined) return 0;
  if (value.length === 1) return Number(value) * 100;
  if (value.length === 2) return Number(value) * 10;
  return Number(value);
}

function srtMilliseconds(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match) throw new LyricParseError("invalid_srt_time", "Invalid SRT timestamp");
  const [, hours, minutes, seconds, milliseconds] = match;
  if (Number(minutes) >= 60 || Number(seconds) >= 60) {
    throw new LyricParseError("invalid_srt_time", "Invalid SRT timestamp");
  }
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1000 +
    Number(milliseconds)
  );
}

function validateParsedLyrics(lines: ParsedLyricLine[]): ParsedLyricLine[] {
  let previousEnd = -1;
  for (const line of lines) {
    if (line.start_ms === null) continue;
    if (line.end_ms !== null && line.end_ms <= line.start_ms) {
      throw new LyricParseError("invalid_lyric_time", "Invalid lyric duration");
    }
    if (line.start_ms < previousEnd) {
      throw new LyricParseError("overlapping_lyrics", "Lyrics overlap");
    }
    previousEnd = line.end_ms ?? line.start_ms;
  }
  return lines;
}

export function parseLyricsInput(
  source: string,
  format: LyricInputFormat,
): ParsedLyricLine[] {
  if (source.includes("\0")) {
    throw new LyricParseError("binary_lyrics", "Lyrics contain binary data");
  }
  const normalized = source
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (format === "txt") {
    const lines = normalized.split("\n").map((text) => ({
      text_nfc: text,
      start_ms: null,
      end_ms: null,
      is_stanza_break: text.trim().length === 0,
    }));
    if (!lines.some((line) => !line.is_stanza_break)) {
      throw new LyricParseError("empty_lyrics", "Lyrics are empty");
    }
    return lines;
  }
  if (format === "lrc") {
    const parsed: Array<{ start: number; text: string }> = [];
    for (const row of normalized.split("\n")) {
      if (/^\[[A-Za-z]+:/.test(row)) continue;
      const match = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/.exec(
        row,
      );
      if (!match || !match[2]) {
        throw new LyricParseError("invalid_lrc", "Invalid LRC lyric line");
      }
      for (const timestamp of match[1].matchAll(
        /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g,
      )) {
        if (Number(timestamp[2]) >= 60) {
          throw new LyricParseError("invalid_lrc_time", "Invalid LRC time");
        }
        parsed.push({
          start:
            Number(timestamp[1]) * 60_000 +
            Number(timestamp[2]) * 1000 +
            fractionMilliseconds(timestamp[3]),
          text: match[2],
        });
      }
    }
    parsed.sort((left, right) => left.start - right.start);
    return validateParsedLyrics(
      parsed.map((line, index) => ({
        text_nfc: line.text,
        start_ms: line.start,
        end_ms: parsed[index + 1]?.start ?? null,
        is_stanza_break: false,
      })),
    );
  }
  const cues = normalized.split(/\n\s*\n/).map((block) => {
    const rows = block.split("\n");
    if (/^\d+$/.test(rows[0] ?? "")) rows.shift();
    const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(rows.shift() ?? "");
    if (!timing || rows.length === 0) {
      throw new LyricParseError("invalid_srt", "Invalid SRT cue");
    }
    return {
      text_nfc: rows.join("\n"),
      start_ms: srtMilliseconds(timing[1]),
      end_ms: srtMilliseconds(timing[2]),
      is_stanza_break: false,
    };
  });
  return validateParsedLyrics(cues);
}

export const PitchFrameSchema = z
  .object({
    time_ms: z.number().int().nonnegative(),
    frequency_hz: z.number().finite().positive().nullable(),
    midi: z.number().finite().nullable(),
    confidence,
    voiced: z.boolean(),
  })
  .strict()
  .refine(
    (frame) =>
      frame.voiced === (frame.frequency_hz !== null && frame.midi !== null),
    {
      message:
        "voiced frames require frequency_hz and midi; unvoiced frames require nulls",
    },
  );
export type PitchFrame = z.infer<typeof PitchFrameSchema>;

export const SongSectionSchema = z
  .object({
    id,
    label: z.string().trim().min(1).max(100),
    start_seconds: nonNegative,
    end_seconds: nonNegative,
  })
  .strict()
  .refine((section) => section.end_seconds > section.start_seconds, {
    message: "end_seconds must be greater than start_seconds",
  });
export type SongSection = z.infer<typeof SongSectionSchema>;

export const PitchRangeMetadataSchema = z
  .object({
    minimum_frequency_hz: z.number().finite().positive().nullable(),
    maximum_frequency_hz: z.number().finite().positive().nullable(),
  })
  .strict()
  .refine(
    (range) =>
      range.minimum_frequency_hz === null ||
      range.maximum_frequency_hz === null ||
      range.maximum_frequency_hz >= range.minimum_frequency_hz,
    { message: "pitch range must be ordered" },
  );

export const EnergyPointSchema = z
  .object({
    time_ms: z.number().int().nonnegative(),
    rms: nonNegative,
  })
  .strict();

export const AnalysisPackageV1Schema = z
  .object({
    analysis_version: z.literal(ANALYSIS_VERSION),
    session_id: id,
    generated_at: timestamp,
    duration_seconds: z.number().finite().positive(),
    pitch_frames: z.array(PitchFrameSchema),
    input_checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    pipeline_version: z.string().min(1),
    model_identifier: z.string().min(1),
    pitch_range: PitchRangeMetadataSchema,
    voiced_coverage: confidence,
    estimated_tempo_bpm: z.number().finite().positive().nullable(),
    tempo_confidence: confidence,
    tempo_limitation: z.string().min(1),
    beat_timestamps_ms: z.array(z.number().int().nonnegative()),
    energy_envelope: z.array(EnergyPointSchema),
    sections: z.array(SongSectionSchema),
  })
  .strict();
export type AnalysisPackageV1 = z.infer<typeof AnalysisPackageV1Schema>;

export const PracticeAttemptSummarySchema = z
  .object({
    id,
    session_id: id,
    completed_at: timestamp,
    pitch_score: confidence,
    timing_score: confidence,
    contour_score: confidence,
    stability_score: confidence,
    completion_score: confidence,
    valid_voiced_frames: z.number().int().nonnegative(),
  })
  .strict();
export type PracticeAttemptSummary = z.infer<
  typeof PracticeAttemptSummarySchema
>;

export const ApiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        request_id: z.string().min(1),
        details: z.record(z.unknown()).nullable().default(null),
      })
      .strict(),
  })
  .strict();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
