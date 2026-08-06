import { afterEach, describe, expect, it, vi } from "vitest";

import { detectPracticeCapabilities } from "./use-practice-capabilities";

describe("detectPracticeCapabilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports a missing microphone API", () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });
    expect(detectPracticeCapabilities()).toContain(
      "microphone_api_unavailable",
    );
  });

  it("reports missing Web Audio support", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(detectPracticeCapabilities()).toContain("audio_context_unavailable");
  });
});
