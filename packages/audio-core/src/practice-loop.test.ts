import { describe, expect, it } from "vitest";

import { createLoopRegion, LoopBoundaryTracker } from "./practice-loop";

describe("LoopBoundaryTracker", () => {
  it("restarts exactly at a deterministic loop boundary", () => {
    const tracker = new LoopBoundaryTracker();
    const region = createLoopRegion(1_000, 2_000);
    expect(tracker.update(region, 1_999, 10_000).type).toBe("none");
    expect(tracker.update(region, 2_000, 10_001)).toEqual({
      type: "restart",
      seekToMs: 1_000,
    });
  });

  it("waits on a monotonic count-in deadline before restart", () => {
    const tracker = new LoopBoundaryTracker();
    const region = createLoopRegion(1_000, 2_000, 2_000);
    expect(tracker.update(region, 2_000, 10_000)).toEqual({
      type: "begin_count_in",
      seekToMs: 1_000,
    });
    expect(tracker.update(region, 1_000, 11_999).type).toBe("none");
    expect(tracker.update(region, 1_000, 12_000)).toEqual({
      type: "restart",
      seekToMs: 1_000,
    });
  });

  it("rejects crossing or tiny loop points", () => {
    expect(() => createLoopRegion(2_000, 1_000)).toThrow();
    expect(() => createLoopRegion(1_000, 1_100)).toThrow();
  });
});
