import { describe, expect, it } from "vitest";

import { generatePhraseFeedback, generateSessionFeedback } from "./feedback";
import {
  calculatePhraseMetrics,
  type PhraseComparisonSample,
} from "./phrase-metrics";

function evidence(
  signedCents: number,
  timeOffsetMs = 0,
  valid = 8,
  expected = 8,
) {
  const samples: PhraseComparisonSample[] = Array.from(
    { length: valid },
    (_, index) => ({
      timeMs: index * 100,
      referenceMidi: 60,
      userMidi: 60 + signedCents / 100,
      signedCents,
      timeOffsetMs,
      confidence: 0.95,
    }),
  );
  return {
    metrics: calculatePhraseMetrics(samples, expected),
    referenceDirection: "up" as const,
  };
}

describe("feedback rules", () => {
  it("prioritizes directional pitch and timing corrections", () => {
    expect(generatePhraseFeedback(evidence(48, -120))).toMatchInlineSnapshot(`
      [
        {
          "code": "consistently_sharp",
          "kind": "correction",
          "message": "സ്വരം സാധാരണയായി 48 സെന്റ് ഉയരത്തിലാണ്.",
          "priority": 90,
        },
        {
          "code": "phrase_late",
          "kind": "correction",
          "message": "വരി ഏകദേശം 120 ms വൈകി തുടങ്ങി.",
          "priority": 75,
        },
        {
          "code": "good_contour",
          "kind": "strength",
          "message": "മുകളിലേക്കുള്ള സ്വരചലനം നന്നായി പിന്തുടർന്നു.",
          "priority": 40,
        },
      ]
    `);
  });

  it("reports early completion after a correctly reached target", () => {
    const feedback = generatePhraseFeedback(evidence(0, 0, 5, 10));
    expect(feedback.map(({ code }) => code)).toContain("note_ended_early");
  });

  it("prioritizes probable octave mismatch", () => {
    const feedback = generatePhraseFeedback({
      ...evidence(1_200),
      octaveMismatchRatio: 0.8,
    });
    expect(feedback[0]?.code).toBe("probable_octave_mismatch");
    expect(feedback).toHaveLength(3);
  });

  it("labels insufficient evidence without speculative corrections", () => {
    expect(generatePhraseFeedback(evidence(0, 0, 1, 20)))
      .toMatchInlineSnapshot(`
      [
        {
          "code": "insufficient_voiced_data",
          "kind": "insufficient",
          "message": "വിലയിരുത്താൻ മതിയായ വ്യക്തമായ സ്വര ഡാറ്റ ലഭിച്ചില്ല.",
          "priority": 100,
        },
      ]
    `);
  });

  it("caps session feedback and removes contradictory directions", () => {
    const session = generateSessionFeedback([
      evidence(50, 120),
      evidence(-80, -150),
      { ...evidence(1_200), octaveMismatchRatio: 0.8 },
    ]);
    expect(session.length).toBeLessThanOrEqual(5);
    const codes = session.map(({ code }) => code);
    expect(
      codes.includes("consistently_sharp") &&
        codes.includes("consistently_flat"),
    ).toBe(false);
    expect(
      codes.includes("phrase_early") && codes.includes("phrase_late"),
    ).toBe(false);
  });
});
