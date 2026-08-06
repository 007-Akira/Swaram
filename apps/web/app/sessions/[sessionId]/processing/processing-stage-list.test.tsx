import { describe, expect, it } from "vitest";

import { processingStageLabel, stageIndex } from "./processing-stage-list";

describe("processing stage mapping", () => {
  it("maps real worker stages to user-facing stages", () => {
    expect(processingStageLabel("normalizing")).toBe("Converting audio");
    expect(processingStageLabel("stem_separation_running")).toBe(
      "Separating vocals",
    );
    expect(processingStageLabel("extracting_contour")).toBe(
      "Extracting reference pitch",
    );
    expect(stageIndex("storing_results")).toBeGreaterThan(
      stageIndex("normalizing"),
    );
  });

  it("does not invent progress for an unknown stage", () => {
    expect(stageIndex("future_worker_stage")).toBe(0);
  });
});
