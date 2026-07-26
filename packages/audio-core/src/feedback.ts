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
        "വിലയിരുത്താൻ മതിയായ വ്യക്തമായ സ്വര ഡാറ്റ ലഭിച്ചില്ല.",
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
        "ലക്ഷ്യസ്വരത്തേക്കാൾ വേറൊരു ഓക്ടേവിൽ പാടിയതായി തോന്നുന്നു.",
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
        `സ്വരം സാധാരണയായി ${Math.round(signedCents)} സെന്റ് ഉയരത്തിലാണ്.`,
      ),
    );
  } else if (signedCents <= -25) {
    results.push(
      observation(
        "consistently_flat",
        "correction",
        90,
        `സ്വരം സാധാരണയായി ${Math.round(Math.abs(signedCents))} സെന്റ് താഴെയാണ്.`,
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
          `വരി ഏകദേശം ${Math.round(onsetOffset)} ms നേരത്തേ തുടങ്ങി.`,
        ),
      );
    } else if (onsetOffset <= -80) {
      results.push(
        observation(
          "phrase_late",
          "correction",
          75,
          `വരി ഏകദേശം ${Math.round(Math.abs(onsetOffset))} ms വൈകി തുടങ്ങി.`,
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
        "ലക്ഷ്യസ്വരം ശരിയായി എത്തിയെങ്കിലും വരി നേരത്തേ അവസാനിച്ചു.",
      ),
    );
  }

  if (metrics.stability.sufficient && (metrics.stability.score ?? 100) < 60) {
    results.push(
      observation(
        "unstable_sustain",
        "correction",
        65,
        "നീട്ടിപ്പാടുന്ന സ്വരത്തിൽ ആവശ്യത്തിലധികം ചലനം ഉണ്ടായിരുന്നു.",
      ),
    );
  }

  if (
    metrics.contour.sufficient &&
    (metrics.contour.score ?? 0) >= 85 &&
    evidence.referenceDirection !== "level"
  ) {
    const direction =
      evidence.referenceDirection === "down" ? "താഴേക്കുള്ള" : "മുകളിലേക്കുള്ള";
    results.push(
      observation(
        "good_contour",
        "strength",
        40,
        `${direction} സ്വരചലനം നന്നായി പിന്തുടർന്നു.`,
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
