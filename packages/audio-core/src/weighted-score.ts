import type { PhraseMetric, PhraseMetrics } from "./phrase-metrics";

export const SCORE_VERSION = "1.0.0";

export type ScoreComponent =
  | "pitch"
  | "timing"
  | "contour"
  | "stability"
  | "completion";

export type ScoreWeights = Readonly<Record<ScoreComponent, number>>;
export type ToleranceProfileName = "beginner" | "intermediate";

export interface ToleranceProfile {
  readonly pitchCents: number;
  readonly timingMs: number;
  readonly contourCents: number;
  readonly stabilityAllowanceCents: number;
  readonly stabilityRangeCents: number;
}

export interface WeightedPhraseScore {
  readonly overall: number | null;
  readonly components: Readonly<Record<ScoreComponent, number | null>>;
  readonly normalizedWeights: Readonly<Record<ScoreComponent, number>>;
  readonly evidenceConfidence: number;
  readonly scoringVersion: typeof SCORE_VERSION;
  readonly toleranceProfile: ToleranceProfileName;
  readonly notice: string;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  pitch: 0.45,
  timing: 0.2,
  contour: 0.2,
  stability: 0.1,
  completion: 0.05,
};

export const TOLERANCE_PROFILES: Readonly<
  Record<ToleranceProfileName, ToleranceProfile>
> = {
  beginner: {
    pitchCents: 150,
    timingMs: 450,
    contourCents: 300,
    stabilityAllowanceCents: 50,
    stabilityRangeCents: 150,
  },
  intermediate: {
    pitchCents: 100,
    timingMs: 300,
    contourCents: 200,
    stabilityAllowanceCents: 35,
    stabilityRangeCents: 100,
  },
};

function bounded(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function componentScore(
  component: ScoreComponent,
  metric: PhraseMetric,
  profile: ToleranceProfile,
): number | null {
  if (!metric.sufficient || metric.score === null || metric.value === null) {
    return null;
  }
  if (component === "completion") return bounded(metric.score);
  if (component === "pitch") {
    return bounded(100 - (metric.value / profile.pitchCents) * 100);
  }
  if (component === "timing") {
    return bounded(100 - (Math.abs(metric.value) / profile.timingMs) * 100);
  }
  if (component === "contour") {
    return bounded(100 - (metric.value / profile.contourCents) * 100);
  }
  return bounded(
    100 -
      (Math.max(0, metric.value - profile.stabilityAllowanceCents) /
        profile.stabilityRangeCents) *
        100,
  );
}

export function calculateWeightedScore(
  metrics: PhraseMetrics,
  profileName: ToleranceProfileName = "intermediate",
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): WeightedPhraseScore {
  const entries = Object.entries(weights) as Array<[ScoreComponent, number]>;
  if (
    entries.some(([, weight]) => !Number.isFinite(weight) || weight < 0) ||
    entries.every(([, weight]) => weight === 0)
  ) {
    throw new Error(
      "Scoring weights must be finite, non-negative, and non-zero",
    );
  }
  const profile = TOLERANCE_PROFILES[profileName];
  const components = Object.fromEntries(
    entries.map(([component]) => [
      component,
      componentScore(component, metrics[component], profile),
    ]),
  ) as Record<ScoreComponent, number | null>;
  const available = entries.filter(
    ([component, weight]) => components[component] !== null && weight > 0,
  );
  const availableWeight = available.reduce(
    (sum, [, weight]) => sum + weight,
    0,
  );
  const normalizedWeights = Object.fromEntries(
    entries.map(([component, weight]) => [
      component,
      components[component] === null || availableWeight === 0
        ? 0
        : weight / availableWeight,
    ]),
  ) as Record<ScoreComponent, number>;
  const overall =
    availableWeight === 0
      ? null
      : bounded(
          available.reduce(
            (sum, [component]) =>
              sum + (components[component] ?? 0) * normalizedWeights[component],
            0,
          ),
        );
  const evidenceConfidence =
    availableWeight === 0
      ? 0
      : available.reduce(
          (sum, [component]) =>
            sum + metrics[component].confidence * normalizedWeights[component],
          0,
        );
  return {
    overall,
    components,
    normalizedWeights,
    evidenceConfidence,
    scoringVersion: SCORE_VERSION,
    toleranceProfile: profileName,
    notice:
      "Practice coaching only; this score is not medical or vocal-health advice.",
  };
}
