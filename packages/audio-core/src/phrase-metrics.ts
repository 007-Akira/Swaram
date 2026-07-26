export interface PhraseComparisonSample {
  readonly timeMs: number;
  readonly referenceMidi: number;
  readonly userMidi: number;
  readonly signedCents: number;
  readonly timeOffsetMs: number;
  readonly confidence: number;
}

export interface PhraseMetric {
  readonly score: number | null;
  readonly value: number | null;
  readonly confidence: number;
  readonly coverage: number;
  readonly sufficient: boolean;
}

export interface PhraseMetrics {
  readonly pitch: PhraseMetric;
  readonly timing: PhraseMetric;
  readonly contour: PhraseMetric;
  readonly stability: PhraseMetric;
  readonly completion: PhraseMetric;
  readonly medianSignedCents: number | null;
  readonly validFrameCount: number;
  readonly expectedFrameCount: number;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function metric(
  score: number | null,
  value: number | null,
  confidence: number,
  coverage: number,
  sufficient: boolean,
): PhraseMetric {
  return {
    score: score === null ? null : clampScore(score),
    value,
    confidence: Math.max(0, Math.min(1, confidence)),
    coverage: Math.max(0, Math.min(1, coverage)),
    sufficient,
  };
}

export function calculatePhraseMetrics(
  samples: readonly PhraseComparisonSample[],
  expectedFrameCount: number,
): PhraseMetrics {
  const ordered = [...samples].sort(
    (left, right) => left.timeMs - right.timeMs,
  );
  const validCount = ordered.length;
  const expected = Math.max(0, Math.round(expectedFrameCount));
  const coverage = expected > 0 ? Math.min(1, validCount / expected) : 0;
  const averageConfidence =
    validCount > 0
      ? ordered.reduce((sum, sample) => sum + sample.confidence, 0) / validCount
      : 0;
  const evidenceConfidence = averageConfidence * coverage;
  const enoughTrajectory = validCount >= 3 && coverage >= 0.15;

  const signedCents = ordered.map(({ signedCents: value }) => value);
  const medianSignedCents = signedCents.length > 0 ? median(signedCents) : null;
  const medianAbsoluteCents =
    signedCents.length > 0
      ? median(signedCents.map((value) => Math.abs(value)))
      : null;
  const pitch = enoughTrajectory
    ? metric(
        100 - ((medianAbsoluteCents ?? 0) / 100) * 100,
        medianAbsoluteCents,
        evidenceConfidence,
        coverage,
        true,
      )
    : metric(null, medianAbsoluteCents, evidenceConfidence, coverage, false);

  const onsetOffset = ordered[0]?.timeOffsetMs ?? null;
  const timing =
    onsetOffset === null
      ? metric(null, null, 0, coverage, false)
      : metric(
          100 - (Math.abs(onsetOffset) / 300) * 100,
          onsetOffset,
          evidenceConfidence,
          coverage,
          true,
        );

  let contourErrorCents: number | null = null;
  if (enoughTrajectory) {
    const first = ordered[0]!;
    contourErrorCents = median(
      ordered.map(
        (sample) =>
          Math.abs(
            sample.userMidi -
              first.userMidi -
              (sample.referenceMidi - first.referenceMidi),
          ) * 100,
      ),
    );
  }
  const contour = enoughTrajectory
    ? metric(
        100 - ((contourErrorCents ?? 0) / 200) * 100,
        contourErrorCents,
        evidenceConfidence,
        coverage,
        true,
      )
    : metric(null, null, evidenceConfidence, coverage, false);

  let residualMad: number | null = null;
  if (enoughTrajectory && medianSignedCents !== null) {
    residualMad = median(
      signedCents.map((value) => Math.abs(value - medianSignedCents)),
    );
  }
  const stability = enoughTrajectory
    ? metric(
        100 - (Math.max(0, (residualMad ?? 0) - 35) / 100) * 100,
        residualMad,
        evidenceConfidence,
        coverage,
        true,
      )
    : metric(null, null, evidenceConfidence, coverage, false);

  const completion =
    expected > 0
      ? metric(coverage * 100, coverage, averageConfidence, coverage, true)
      : metric(null, null, 0, 0, false);

  return {
    pitch,
    timing,
    contour,
    stability,
    completion,
    medianSignedCents,
    validFrameCount: validCount,
    expectedFrameCount: expected,
  };
}
