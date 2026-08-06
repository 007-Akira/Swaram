import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttemptReport, type AttemptReportRecord } from "./attempt-report";

const attempt: AttemptReportRecord = {
  id: "attempt-1",
  created_at: "2026-07-26T00:00:00Z",
  data: {
    analysis_version: "1.0",
    score_version: "1.0",
    tolerance_profile: "intermediate",
    mode: "instrumental",
    speed: 1,
    latency_offset_ms: 30,
    overall_score: 88,
    component_scores: { pitch: 90, timing: 80 },
    evidence_confidence: 0.75,
    valid_voiced_frames: 245,
    feedback: [
      {
        code: "sharp",
        kind: "correction",
        message: "Your pitch is slightly high.",
      },
    ],
    phrases: [
      {
        line_id: "line-1",
        text: "പവിഴമഴയേ",
        start_ms: 1_000,
        end_ms: 3_000,
        score: 90,
        metrics: {
          pitch: {
            score: 90,
            value: 12,
            confidence: 0.8,
            coverage: 0.7,
            sufficient: true,
          },
        },
        feedback: [],
      },
    ],
  },
};

describe("AttemptReport", () => {
  it("shows scores, confidence, feedback, and phrase replay", () => {
    render(
      <AttemptReport attempt={attempt} history={[]} sessionId="session-1" />,
    );
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText(/evidence confidence: 75%/i)).toBeInTheDocument();
    expect(
      screen.getByText("Your pitch is slightly high."),
    ).toBeInTheDocument();
    expect(screen.getByText("245")).toBeInTheDocument();
    expect(screen.getByText("instrumental")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Practice this line again" }),
    ).toHaveAttribute("href", "/sessions/session-1/practice?seek=1000");
  });
});
