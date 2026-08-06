import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("Home", () => {
  beforeEach(() => {
    cleanup();
    push.mockReset();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("renders the product entry experience", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", {
        name: /create a private practice session/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /set up your practice/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create private practice/i }),
    ).toBeInTheDocument();
  });

  it("requires audio and lyrics before creating a session", () => {
    render(<Home />);

    fireEvent.click(
      screen.getByRole("button", { name: /create private practice/i }),
    );

    expect(
      screen.getByText(/add one audio file and either paste or upload/i),
    ).toBeInTheDocument();
  });

  it("opens real processing after private uploads", async () => {
    const responses = [
      {
        id: "session-1",
        access_token: "private-token",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      { id: "audio-1" },
      { document_id: "lyrics-1", line_count: 1, job_id: "job-1" },
    ];
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responses.shift()),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Home />);
    fireEvent.change(screen.getByLabelText("Reference audio"), {
      target: {
        files: [new File(["audio"], "song.wav", { type: "audio/wav" })],
      },
    });
    fireEvent.change(screen.getByLabelText("Paste lyrics"), {
      target: { value: "പാട്ട്" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create private practice/i }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/sessions/session-1/processing"),
    );
    expect(window.sessionStorage.getItem("swaram:session-1:job-id")).toBe(
      "job-1",
    );
  });
});
