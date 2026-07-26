import type { PhraseMetrics } from "./phrase-metrics";

export type FeedbackKind = "strength" | "correction" | "insufficient";

export interface FeedbackObservation {
  readonly code: string;
  readonly kind: FeedbackKind;
  readonly priority: number;
  readonly message: string;
}

export interface PhraseFeedbackEvidence {
  readonly metrics: PhraseMetrics;
  readonly octaveMismatchRatio?: number;
  readonly referenceDirection?: "up" | "down" | "level";
}

function observation(
  code: string,
  kind: FeedbackKind,
  priority: number,
  message: string,
): FeedbackObservation {
  return { code, kind, priority, message };
}

export function generatePhraseFeedback(
  evidence: PhraseFeedbackEvidence,
): readonly FeedbackObservation[] {
  const { metrics } = evidence;
  if (!metrics.pitch.sufficient || metrics.pitch.score === null) {
    return [
      observation(
        "insufficient_voiced_data",
        "insufficient",
        100,
        "There was not enough clear voiced data for a reliable assessment.",
      ),
    ];
  }

  const results: FeedbackObservation[] = [];
  if ((evidence.octaveMismatchRatio ?? 0) >= 0.3) {
    results.push(
      observation(
        "probable_octave_mismatch",
        "correction",
        95,
        "You may be singing in a different octave from the reference.",
      ),
    );
  }

  const signedCents = metrics.medianSignedCents ?? 0;
  if (signedCents >= 25) {
    results.push(
      observation(
        "consistently_sharp",
        "correction",
        90,
        `Your pitch is usually ${Math.round(signedCents)} cents sharp.`,
      ),
    );
  } else if (signedCents <= -25) {
    results.push(
      observation(
        "consistently_flat",
        "correction",
        90,
        `Your pitch is usually ${Math.round(Math.abs(signedCents))} cents flat.`,
      ),
    );
  }

  const onsetOffset = metrics.timing.value;
  if (metrics.timing.sufficient && onsetOffset !== null) {
    if (onsetOffset >= 80) {
      results.push(
        observation(
          "phrase_early",
          "correction",
          75,
          `The line started about ${Math.round(onsetOffset)} ms early.`,
        ),
      );
    } else if (onsetOffset <= -80) {
      results.push(
        observation(
          "phrase_late",
          "correction",
          75,
          `The line started about ${Math.round(Math.abs(onsetOffset))} ms late.`,
        ),
      );
    }
  }

  if (
    (metrics.pitch.score ?? 0) >= 70 &&
    (metrics.completion.score ?? 100) < 70
  ) {
    results.push(
      observation(
        "note_ended_early",
        "correction",
        70,
        "You reached the target pitch, but the line ended early.",
      ),
    );
  }

  if (metrics.stability.sufficient && (metrics.stability.score ?? 100) < 60) {
    results.push(
      observation(
        "unstable_sustain",
        "correction",
        65,
        "The sustained note had more pitch movement than expected.",
      ),
    );
  }

  if (
    metrics.contour.sufficient &&
    (metrics.contour.score ?? 0) >= 85 &&
    evidence.referenceDirection !== "level"
  ) {
    const direction =
      evidence.referenceDirection === "down" ? "downward" : "upward";
    results.push(
      observation(
        "good_contour",
        "strength",
        40,
        `You followed the ${direction} pitch contour well.`,
      ),
    );
  }

  return results
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 3);
}

const CONTRADICTORY_GROUPS = [
  new Set(["consistently_sharp", "consistently_flat"]),
  new Set(["phrase_early", "phrase_late"]),
];

export function generateSessionFeedback(
  phrases: readonly PhraseFeedbackEvidence[],
): readonly FeedbackObservation[] {
  const candidates = phrases
    .flatMap((phrase) => generatePhraseFeedback(phrase))
    .sort((left, right) => right.priority - left.priority);
  const selected: FeedbackObservation[] = [];
  const codes = new Set<string>();
  for (const candidate of candidates) {
    if (codes.has(candidate.code)) continue;
    if (
      CONTRADICTORY_GROUPS.some(
        (group) =>
          group.has(candidate.code) &&
          [...group].some((code) => codes.has(code)),
      )
    ) {
      continue;
    }
    selected.push(candidate);
    codes.add(candidate.code);
    if (selected.length === 5) break;
  }
  return selected;
}
