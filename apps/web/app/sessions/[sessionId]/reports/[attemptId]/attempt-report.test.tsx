import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttemptReport, type AttemptReportRecord } from "./attempt-report";

const attempt: AttemptReportRecord = {
  id: "attempt-1",
  created_at: "2026-07-26T00:00:00Z",
  data: {
    overall_score: 88,
    component_scores: { pitch: 90, timing: 80 },
    evidence_confidence: 0.75,
    feedback: [
      {
        code: "sharp",
        kind: "correction",
        message: "സ്വരം അല്പം ഉയരത്തിലാണ്.",
      },
    ],
    phrases: [
      {
        line_id: "line-1",
        text: "പവിഴമഴയേ",
        start_ms: 1_000,
        score: 90,
        metrics: { pitch: { confidence: 0.8, coverage: 0.7 } },
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
    expect(screen.getByText(/ആത്മവിശ്വാസം: 75%/)).toBeInTheDocument();
    expect(screen.getByText("സ്വരം അല്പം ഉയരത്തിലാണ്.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ഈ വരി വീണ്ടും പരിശീലിക്കുക" }),
    ).toHaveAttribute("href", "/sessions/session-1/practice?seek=1000");
  });
});
