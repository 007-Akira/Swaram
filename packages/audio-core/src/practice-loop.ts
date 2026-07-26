export interface LoopRegion {
  readonly startMs: number;
  readonly endMs: number;
  readonly countInMs: number;
}

export type LoopBoundaryAction =
  | { readonly type: "none" }
  | { readonly type: "begin_count_in"; readonly seekToMs: number }
  | { readonly type: "restart"; readonly seekToMs: number };

export function createLoopRegion(
  startMs: number,
  endMs: number,
  countInMs = 0,
): LoopRegion {
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    !Number.isFinite(countInMs) ||
    startMs < 0 ||
    endMs - startMs < 250 ||
    countInMs < 0
  ) {
    throw new Error(
      "Loop requires ordered finite points at least 250 ms apart",
    );
  }
  return { startMs, endMs, countInMs };
}

export class LoopBoundaryTracker {
  private resumeAtMs: number | null = null;

  update(
    region: LoopRegion,
    songTimeMs: number,
    monotonicTimeMs: number,
  ): LoopBoundaryAction {
    if (this.resumeAtMs !== null) {
      if (monotonicTimeMs < this.resumeAtMs) return { type: "none" };
      this.resumeAtMs = null;
      return { type: "restart", seekToMs: region.startMs };
    }
    if (songTimeMs < region.endMs) return { type: "none" };
    if (region.countInMs === 0) {
      return { type: "restart", seekToMs: region.startMs };
    }
    this.resumeAtMs = monotonicTimeMs + region.countInMs;
    return { type: "begin_count_in", seekToMs: region.startMs };
  }

  reset(): void {
    this.resumeAtMs = null;
  }
}
