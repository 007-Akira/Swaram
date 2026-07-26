import { describe, expect, it } from "vitest";

import {
  findTimedValueAtOrBefore,
  normalizeSongTimeMs,
  PracticeClock,
  type MediaPositionSource,
} from "./practice-clock";

function media(
  overrides: Partial<MediaPositionSource> = {},
): MediaPositionSource {
  return {
    currentTime: 0,
    duration: 60,
    paused: true,
    playbackRate: 1,
    loop: false,
    ...overrides,
  };
}

describe("PracticeClock", () => {
  it("follows actual media position across pause and resume", () => {
    const source = { ...media(), currentTime: 10 };
    const clock = new PracticeClock(source);
    expect(clock.current().comparisonTimeMs).toBe(10_000);
    source.paused = false;
    source.currentTime = 10.5;
    expect(clock.current().comparisonTimeMs).toBe(10_500);
    source.paused = true;
    expect(clock.current().comparisonTimeMs).toBe(10_500);
  });

  it("uses media seeks directly instead of accumulating timer drift", () => {
    const source = { ...media(), currentTime: 30 };
    const clock = new PracticeClock(source);
    source.currentTime = 4.25;
    expect(clock.current().rawSongTimeMs).toBe(4_250);
  });

  it("normalizes looping positions deterministically", () => {
    expect(normalizeSongTimeMs(61_000, 60_000, true)).toBe(1_000);
    expect(normalizeSongTimeMs(61_000, 60_000, false)).toBe(60_000);
  });

  it("reflects 0.75x playback while trusting media currentTime", () => {
    const source = { ...media(), playbackRate: 0.75, currentTime: 7.5 };
    const clock = new PracticeClock(source);
    expect(clock.getPlaybackState().playbackRate).toBe(0.75);
    expect(clock.current().comparisonTimeMs).toBe(7_500);
  });

  it("applies latency once and supports deterministic consumer lookup", () => {
    const source = { ...media(), currentTime: 1 };
    const clock = new PracticeClock(source, 80);
    const time = clock.current();
    expect(time).toMatchObject({
      rawSongTimeMs: 1_000,
      comparisonTimeMs: 920,
      latencyApplied: true,
    });
    expect(
      findTimedValueAtOrBefore(
        [
          { timeMs: 0, id: "first" },
          { timeMs: 900, id: "second" },
        ],
        time,
      ),
    ).toMatchObject({ id: "second" });
  });
});
