export type ToleranceClassification =
  | "excellent"
  | "good"
  | "close"
  | "off-pitch";

export type InvalidComparisonReason =
  | "missing-reference"
  | "reference-unvoiced"
  | "user-unvoiced"
  | "low-confidence"
  | "non-positive-frequency";

export interface PitchObservation {
  readonly frequencyHz: number | null;
  readonly confidence: number;
  readonly voiced: boolean;
}

export type PitchComparison =
  | {
      readonly valid: true;
      readonly signedCents: number;
      readonly absoluteCents: number;
      readonly classification: ToleranceClassification;
      readonly reason: null;
    }
  | {
      readonly valid: false;
      readonly signedCents: null;
      readonly absoluteCents: null;
      readonly classification: null;
      readonly reason: InvalidComparisonReason;
    };

function invalid(reason: InvalidComparisonReason): PitchComparison {
  return {
    valid: false,
    signedCents: null,
    absoluteCents: null,
    classification: null,
    reason,
  };
}

export function comparePitchFrames(
  reference: PitchObservation | null,
  user: PitchObservation,
  minimumConfidence = 0.5,
): PitchComparison {
  if (!reference) {
    return invalid("missing-reference");
  }
  if (!reference.voiced) {
    return invalid("reference-unvoiced");
  }
  if (!user.voiced) {
    return invalid("user-unvoiced");
  }
  if (
    reference.confidence < minimumConfidence ||
    user.confidence < minimumConfidence
  ) {
    return invalid("low-confidence");
  }
  if (
    reference.frequencyHz === null ||
    user.frequencyHz === null ||
    reference.frequencyHz <= 0 ||
    user.frequencyHz <= 0 ||
    !Number.isFinite(reference.frequencyHz) ||
    !Number.isFinite(user.frequencyHz)
  ) {
    return invalid("non-positive-frequency");
  }

  const signedCents =
    1_200 * Math.log2(user.frequencyHz / reference.frequencyHz);
  const absoluteCents = Math.abs(signedCents);
  const classification: ToleranceClassification =
    absoluteCents <= 25
      ? "excellent"
      : absoluteCents <= 50
        ? "good"
        : absoluteCents <= 80
          ? "close"
          : "off-pitch";
  return {
    valid: true,
    signedCents,
    absoluteCents,
    classification,
    reason: null,
  };
}
