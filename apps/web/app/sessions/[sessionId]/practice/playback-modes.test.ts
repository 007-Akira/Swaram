import { describe, expect, it } from "vitest";

import {
  playbackModeAvailability,
  preferredPlaybackMode,
} from "./playback-modes";

describe("practice playback modes", () => {
  it("prefers an available instrumental and disables missing modes", () => {
    const modes = playbackModeAvailability([
      { id: "original", kind: "original_audio" },
      { id: "instrumental", kind: "instrumental" },
    ]);
    expect(preferredPlaybackMode(modes)).toBe("instrumental");
    expect(
      modes.find(({ mode }) => mode === "reduced_reference"),
    ).toMatchObject({ available: false, assetId: null });
  });

  it("falls back to original audio without inventing a stem", () => {
    const modes = playbackModeAvailability([
      { id: "original", kind: "original_audio" },
    ]);
    expect(preferredPlaybackMode(modes)).toBe("original");
    expect(modes.find(({ mode }) => mode === "instrumental")?.available).toBe(
      false,
    );
  });
});
