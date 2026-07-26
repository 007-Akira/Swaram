import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { PracticeSession } from "./practice-session";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("PracticeSession", () => {
  afterEach(() => cleanup());

  it("does not request private audio without the session token", async () => {
    window.sessionStorage.clear();
    render(<PracticeSession sessionId="private-session" />);
    expect(
      await screen.findByText(
        "The access token for this private session is unavailable.",
      ),
    ).toBeInTheDocument();
  });
});
