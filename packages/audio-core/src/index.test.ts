import { describe, expect, it } from "vitest";

import { AUDIO_CORE_VERSION } from "./index.js";

describe("audio-core package", () => {
  it("contains no audio intelligence in the baseline", () => {
    expect(AUDIO_CORE_VERSION).toBe("0.0.0");
  });
});
