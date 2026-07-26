import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const analysis = {
  analysis_version: "1.0",
  session_id: "c7ef39d4-7167-45cf-bd31-bfc9a32e1b15",
  generated_at: "2026-07-26T10:00:00Z",
  duration_seconds: 4,
  pitch_frames: [
    {
      time_ms: 0,
      frequency_hz: 440,
      midi: 69,
      confidence: 1,
      voiced: true,
    },
    {
      time_ms: 4000,
      frequency_hz: 440,
      midi: 69,
      confidence: 1,
      voiced: true,
    },
  ],
  input_checksum_sha256: "a".repeat(64),
  pipeline_version: "1.0",
  model_identifier: "e2e-generated-tone",
  pitch_range: {
    minimum_frequency_hz: 65,
    maximum_frequency_hz: 1200,
  },
  voiced_coverage: 1,
  estimated_tempo_bpm: null,
  tempo_confidence: 0,
  tempo_limitation: "e2e",
  beat_timestamps_ms: [],
  energy_envelope: [],
  sections: [],
};

test("serves the product entry UI with privacy security headers", async ({
  page,
}) => {
  const response = await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /find the note/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /set up your practice/i }),
  ).toBeVisible();
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["permissions-policy"]).toContain(
    "microphone=(self)",
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
});

test("loads the real private practice route with mocked session APIs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "swaram:e2e-session:token",
      "private-e2e-token",
    );
  });
  await page.route(
    "http://localhost:8000/api/v1/sessions/e2e-session",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e-session",
          assets: [{ id: "audio-1", kind: "original_audio" }],
        }),
      }),
  );
  await page.route(
    "http://localhost:8000/api/v1/sessions/e2e-session/analysis",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(analysis),
      }),
  );
  await page.route(
    "http://localhost:8000/api/v1/sessions/e2e-session/lyrics",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          lines: [
            {
              id: "line-1",
              text: "മലയാളം പരിശീലനം",
              start_ms: 0,
              end_ms: 4000,
              is_stanza_break: false,
            },
          ],
        }),
      }),
  );
  await page.route(
    "**/api/v1/sessions/e2e-session/assets/audio-1/playback-url",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          url: "http://localhost:8000/private-playback",
        }),
      }),
  );

  await page.goto("/sessions/e2e-session/practice");
  await expect(
    page.getByRole("heading", { name: "ഹെഡ്ഫോൺ പരിശോധന" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "മൈക്രോഫോൺ അനുവദിക്കുക" }),
  ).toBeVisible();
  await expect(page.getByText(/24 മണിക്കൂറിന് ശേഷം/u)).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
});
