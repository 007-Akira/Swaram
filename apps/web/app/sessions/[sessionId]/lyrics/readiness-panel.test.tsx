import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadinessPanel } from "./readiness-panel";

describe("ReadinessPanel", () => {
  afterEach(() => cleanup());

  it("shows actionable fixes and disables practice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ready: false,
          issues: [
            {
              code: "lyrics_untimed",
              message: "Every lyric line needs timing.",
              action: "Use tap-to-sync.",
            },
          ],
        }),
      }),
    );
    render(
      <ReadinessPanel refreshKey={0} sessionId="session-1" token="token" />,
    );
    expect(await screen.findByText("Use tap-to-sync.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start practice" }),
    ).toBeDisabled();
  });

  it("enables practice only when the API reports ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ready: true, issues: [] }),
      }),
    );
    render(
      <ReadinessPanel refreshKey={0} sessionId="session-1" token="token" />,
    );
    expect(await screen.findByText("Everything is ready.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Start practice" }),
    ).toHaveAttribute("href", "/sessions/session-1/practice");
  });
});
