export interface DeviceLatencyEvidence {
  readonly baseLatencySeconds?: number;
  readonly outputLatencySeconds?: number;
  readonly detectedRoundTripMs?: number;
}

export interface CorrectedSongTime {
  readonly rawSongTimeMs: number;
  readonly comparisonTimeMs: number;
  readonly latencyOffsetMs: number;
  readonly latencyApplied: true;
}

const MAX_LATENCY_MS = 1_000;
const MAX_MANUAL_NUDGE_MS = 250;

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

export function estimateLatencyOffsetMs(
  evidence: DeviceLatencyEvidence,
): number {
  const browserEstimateMs =
    (finiteNonNegative(evidence.baseLatencySeconds) +
      finiteNonNegative(evidence.outputLatencySeconds)) *
    1_000;
  const measuredRoundTripMs = finiteNonNegative(evidence.detectedRoundTripMs);
  const estimate =
    measuredRoundTripMs > 0
      ? Math.max(browserEstimateMs, measuredRoundTripMs / 2)
      : browserEstimateMs;
  return Math.min(MAX_LATENCY_MS, Math.round(estimate));
}

export function nudgeLatencyOffsetMs(
  currentOffsetMs: number,
  nudgeMs: number,
): number {
  if (!Number.isFinite(currentOffsetMs) || !Number.isFinite(nudgeMs)) {
    throw new Error("Latency values must be finite");
  }
  const boundedNudge = Math.max(
    -MAX_MANUAL_NUDGE_MS,
    Math.min(MAX_MANUAL_NUDGE_MS, nudgeMs),
  );
  return Math.max(
    0,
    Math.min(MAX_LATENCY_MS, Math.round(currentOffsetMs + boundedNudge)),
  );
}

export function applyLatencyOffset(
  songTimeMs: number,
  latencyOffsetMs: number,
): CorrectedSongTime {
  if (!Number.isFinite(songTimeMs) || !Number.isFinite(latencyOffsetMs)) {
    throw new Error("Song time and latency must be finite");
  }
  return {
    rawSongTimeMs: songTimeMs,
    comparisonTimeMs: Math.max(0, songTimeMs - latencyOffsetMs),
    latencyOffsetMs,
    latencyApplied: true,
  };
}

export function assertUncorrectedSongTime(
  value: number | CorrectedSongTime,
): asserts value is number {
  if (typeof value !== "number") {
    throw new Error("Latency correction has already been applied");
  }
}
