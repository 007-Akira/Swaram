import { applyLatencyOffset, type CorrectedSongTime } from "./latency";

export interface MediaPositionSource {
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly playbackRate: number;
  readonly loop: boolean;
}

export interface TimedValue {
  readonly timeMs: number;
}

export function normalizeSongTimeMs(
  songTimeMs: number,
  durationMs: number,
  loop: boolean,
): number {
  if (!Number.isFinite(songTimeMs) || !Number.isFinite(durationMs)) {
    throw new Error("Song time and duration must be finite");
  }
  if (durationMs <= 0) return Math.max(0, songTimeMs);
  if (!loop) return Math.max(0, Math.min(durationMs, songTimeMs));
  return ((songTimeMs % durationMs) + durationMs) % durationMs;
}

export function findTimedValueAtOrBefore<T extends TimedValue>(
  values: readonly T[],
  time: CorrectedSongTime,
): T | null {
  let low = 0;
  let high = values.length - 1;
  let found: T | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = values[middle];
    if (!candidate) break;
    if (candidate.timeMs <= time.comparisonTimeMs) {
      found = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

export class PracticeClock {
  private latencyOffsetMs: number;

  constructor(
    private readonly media: MediaPositionSource,
    latencyOffsetMs = 0,
  ) {
    this.latencyOffsetMs = latencyOffsetMs;
  }

  current(): CorrectedSongTime {
    const durationMs = Number.isFinite(this.media.duration)
      ? this.media.duration * 1_000
      : 0;
    const rawSongTimeMs = normalizeSongTimeMs(
      this.media.currentTime * 1_000,
      durationMs,
      this.media.loop,
    );
    return applyLatencyOffset(rawSongTimeMs, this.latencyOffsetMs);
  }

  setLatencyOffsetMs(latencyOffsetMs: number): void {
    if (!Number.isFinite(latencyOffsetMs) || latencyOffsetMs < 0) {
      throw new Error("Latency offset must be a non-negative finite number");
    }
    this.latencyOffsetMs = latencyOffsetMs;
  }

  getPlaybackState(): {
    paused: boolean;
    playbackRate: number;
    looping: boolean;
  } {
    return {
      paused: this.media.paused,
      playbackRate: this.media.playbackRate,
      looping: this.media.loop,
    };
  }

  lookup<T extends TimedValue>(values: readonly T[]): T | null {
    return findTimedValueAtOrBefore(values, this.current());
  }
}
