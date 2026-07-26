import {
  calculatePhraseMetrics,
  calculateWeightedScore,
  generatePhraseFeedback,
  generateSessionFeedback,
  SCORE_VERSION,
  type FeedbackObservation,
  type PhraseComparisonSample,
  type PhraseFeedbackEvidence,
} from "@swaram/audio-core";
import type { AnalysisPackageV1 } from "@swaram/contracts";

import type { PlaybackMode } from "./playback-modes";
import type { PracticeLyricLine } from "./practice-lyrics";

const components = [
  "pitch",
  "timing",
  "contour",
  "stability",
  "completion",
] as const;

const feedbackRecord = (item: FeedbackObservation) => ({
  code: item.code,
  kind: item.kind,
  message: item.message,
});

export function buildAttemptPayload(
  analysis: AnalysisPackageV1,
  lyrics: readonly PracticeLyricLine[],
  samples: readonly PhraseComparisonSample[],
  options: {
    mode: PlaybackMode;
    speed: 0.5 | 0.75 | 0.9 | 1;
    latencyOffsetMs: number;
    profile: "beginner" | "intermediate";
  },
) {
  const phraseEvidence: PhraseFeedbackEvidence[] = [];
  const phrases = lyrics.flatMap((line) => {
    if (
      line.is_stanza_break ||
      line.start_ms === null ||
      line.end_ms === null
    ) {
      return [];
    }
    const phraseSamples = samples.filter(
      ({ timeMs }) => timeMs >= line.start_ms! && timeMs < line.end_ms!,
    );
    const reference = analysis.pitch_frames.filter(
      (frame) =>
        frame.voiced &&
        frame.time_ms >= line.start_ms! &&
        frame.time_ms < line.end_ms!,
    );
    const metrics = calculatePhraseMetrics(phraseSamples, reference.length);
    const score = calculateWeightedScore(metrics, options.profile);
    const firstMidi = reference.find(({ midi }) => midi !== null)?.midi;
    const lastMidi = [...reference]
      .reverse()
      .find(({ midi }) => midi !== null)?.midi;
    const referenceDirection =
      firstMidi === undefined ||
      firstMidi === null ||
      lastMidi === undefined ||
      lastMidi === null
        ? "level"
        : lastMidi - firstMidi > 0.5
          ? "up"
          : firstMidi - lastMidi > 0.5
            ? "down"
            : "level";
    const evidence = { metrics, referenceDirection } as const;
    phraseEvidence.push(evidence);
    return [
      {
        line_id: line.id,
        text: line.text,
        start_ms: line.start_ms,
        end_ms: line.end_ms,
        score: score.overall,
        metrics: Object.fromEntries(
          components.map((component) => [component, metrics[component]]),
        ),
        feedback: generatePhraseFeedback(evidence).map(feedbackRecord),
      },
    ];
  });
  const componentScores = Object.fromEntries(
    components.map((component) => {
      const values = phrases
        .map((phrase) => phrase.metrics[component]!.score)
        .filter((value): value is number => value !== null);
      return [
        component,
        values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null,
      ];
    }),
  );
  const phraseScores = phrases
    .map(({ score }) => score)
    .filter((score): score is number => score !== null);
  const confidences = phrases.map(({ metrics }) => metrics.pitch!.confidence);
  return {
    analysis_version: analysis.analysis_version,
    score_version: SCORE_VERSION,
    tolerance_profile: options.profile,
    mode: options.mode,
    speed: options.speed,
    latency_offset_ms: options.latencyOffsetMs,
    overall_score: phraseScores.length
      ? phraseScores.reduce((sum, value) => sum + value, 0) /
        phraseScores.length
      : null,
    component_scores: componentScores,
    evidence_confidence: confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0,
    valid_voiced_frames: samples.length,
    phrases,
    feedback: generateSessionFeedback(phraseEvidence).map(feedbackRecord),
  };
}
