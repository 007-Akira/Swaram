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

export const AnalysisPackageV1Schema = z
  .object({
    analysis_version: z.literal(ANALYSIS_VERSION),
    session_id: id,
    generated_at: timestamp,
    duration_seconds: z.number().finite().positive(),
    pitch_frames: z.array(PitchFrameSchema),
    raw_pitch_frames: z.array(PitchFrameSchema),
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
