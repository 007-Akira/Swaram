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

test("serves Malayalam UI with privacy security headers", async ({ page }) => {
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { name: "സ്വരം" })).toBeVisible();
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

test("loads the practice graph and explains mocked microphone denial", async ({
  page,
}) => {
  await page.route("**/api/prototype-media/analysis", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(analysis),
    }),
  );
  await page.route("**/api/prototype-media/lyrics", (route) =>
    route.fulfill({
      contentType: "text/plain; charset=utf-8",
      body: "[00:00.00]മലയാളം\n[00:02.00]പരിശീലനം",
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "denied" }) },
    });
  });

  await page.goto("/prototype");
  await expect(
    page.getByRole("heading", {
      name: "കേൾക്കൂ · പാടൂ · താരതമ്യം ചെയ്യൂ",
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("റഫറൻസും തത്സമയ ശ്രുതിയും കാണിക്കുന്ന ഗ്രാഫ്"),
  ).toBeVisible();
  await page.getByRole("button", { name: "മൈക്രോഫോൺ തുടങ്ങുക" }).click();
  await expect(
    page.getByText("മൈക്രോഫോൺ അനുമതി ബ്രൗസറിൽ നിരസിച്ചിരിക്കുന്നു.", {
      exact: true,
    }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
});
