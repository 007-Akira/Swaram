import type { CorrectedSongTime } from "./latency";
import {
  comparePitchFrames,
  type InvalidComparisonReason,
  type PitchObservation,
  type ToleranceClassification,
} from "./comparison";

export interface TimedPitchObservation extends PitchObservation {
  readonly timeMs: number;
  readonly transient?: boolean;
}

export interface WindowedComparisonConfig {
  readonly earlyToleranceMs: number;
  readonly lateToleranceMs: number;
  readonly minimumConfidence: number;
  readonly octaveToleranceCents: number;
}

export type WindowedInvalidReason =
  | InvalidComparisonReason
  | "consonant-transient";

export type WindowedPitchComparison =
  | {
      readonly valid: true;
      readonly signedCents: number;
      readonly absoluteCents: number;
      readonly timeOffsetMs: number;
      readonly confidence: number;
      readonly classification: ToleranceClassification;
      readonly probableOctaveMismatch: "up" | "down" | null;
      readonly referenceTimeMs: number;
      readonly reason: null;
    }
  | {
      readonly valid: false;
      readonly signedCents: null;
      readonly absoluteCents: null;
      readonly timeOffsetMs: null;
      readonly confidence: number;
      readonly classification: null;
      readonly probableOctaveMismatch: null;
      readonly referenceTimeMs: null;
      readonly reason: WindowedInvalidReason;
    };

const DEFAULT_CONFIG: WindowedComparisonConfig = {
  earlyToleranceMs: 120,
  lateToleranceMs: 180,
  minimumConfidence: 0.5,
  octaveToleranceCents: 80,
};

function invalid(
  reason: WindowedInvalidReason,
  confidence: number,
): WindowedPitchComparison {
  return {
    valid: false,
    signedCents: null,
    absoluteCents: null,
    timeOffsetMs: null,
    confidence,
    classification: null,
    probableOctaveMismatch: null,
    referenceTimeMs: null,
    reason,
  };
}

function octaveMismatch(
  signedCents: number,
  toleranceCents: number,
): "up" | "down" | null {
  const octaves = Math.round(signedCents / 1_200);
  if (
    octaves === 0 ||
    Math.abs(signedCents - octaves * 1_200) > toleranceCents
  ) {
    return null;
  }
  return octaves > 0 ? "up" : "down";
}

export function comparePitchToReferenceWindow(
  reference: readonly TimedPitchObservation[],
  user: PitchObservation & { readonly transient?: boolean },
  correctedTime: CorrectedSongTime,
  config: Partial<WindowedComparisonConfig> = {},
): WindowedPitchComparison {
  const options = { ...DEFAULT_CONFIG, ...config };
  if (user.transient) return invalid("consonant-transient", user.confidence);
  if (!user.voiced) return invalid("user-unvoiced", user.confidence);
  if (user.confidence < options.minimumConfidence) {
    return invalid("low-confidence", user.confidence);
  }
  if (
    user.frequencyHz === null ||
    !Number.isFinite(user.frequencyHz) ||
    user.frequencyHz <= 0
  ) {
    return invalid("non-positive-frequency", user.confidence);
  }

  const windowStart = correctedTime.comparisonTimeMs - options.earlyToleranceMs;
  const windowEnd = correctedTime.comparisonTimeMs + options.lateToleranceMs;
  const window = reference.filter(
    ({ timeMs }) => timeMs >= windowStart && timeMs <= windowEnd,
  );
  if (window.length === 0) {
    return invalid("missing-reference", user.confidence);
  }
  const evaluated = window.map((candidate) => ({
    candidate,
    comparison: comparePitchFrames(candidate, user, options.minimumConfidence),
  }));
  const plausible = evaluated
    .filter(
      (
        value,
      ): value is {
        candidate: TimedPitchObservation;
        comparison: Extract<
          ReturnType<typeof comparePitchFrames>,
          { valid: true }
        >;
      } => value.comparison.valid,
    )
    .sort(
      (left, right) =>
        left.comparison.absoluteCents - right.comparison.absoluteCents ||
        Math.abs(left.candidate.timeMs - correctedTime.comparisonTimeMs) -
          Math.abs(right.candidate.timeMs - correctedTime.comparisonTimeMs),
    );
  const best = plausible[0];
  if (!best) {
    const reasons = evaluated
      .filter(({ comparison }) => !comparison.valid)
      .map(({ comparison }) => comparison.reason);
    const reason: WindowedInvalidReason = reasons.includes(
      "non-positive-frequency",
    )
      ? "non-positive-frequency"
      : reasons.includes("low-confidence")
        ? "low-confidence"
        : "reference-unvoiced";
    return invalid(reason, user.confidence);
  }
  return {
    valid: true,
    signedCents: best.comparison.signedCents,
    absoluteCents: best.comparison.absoluteCents,
    timeOffsetMs: best.candidate.timeMs - correctedTime.comparisonTimeMs,
    confidence: Math.min(user.confidence, best.candidate.confidence),
    classification: best.comparison.classification,
    probableOctaveMismatch: octaveMismatch(
      best.comparison.signedCents,
      options.octaveToleranceCents,
    ),
    referenceTimeMs: best.candidate.timeMs,
    reason: null,
  };
}
