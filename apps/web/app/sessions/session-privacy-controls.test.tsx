import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionPrivacyControls } from "./session-privacy-controls";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("SessionPrivacyControls", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
    replace.mockReset();
  });

  it("clears private access and opens the deletion-complete state", async () => {
    window.sessionStorage.setItem("swaram:session-1:token", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    render(<SessionPrivacyControls sessionId="session-1" />);
    fireEvent.click(screen.getByText("Delete this session now"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session permanently" }),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/sessions/deleted"),
    );
    expect(window.sessionStorage.getItem("swaram:session-1:token")).toBeNull();
  });

  it("discloses retention and requires confirmation before private deletion", async () => {
    window.sessionStorage.setItem("swaram:session-1:token", "secret");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionPrivacyControls sessionId="session-1" />);

    expect(screen.getByText(/automatically removed 24 hours/u)).toBeVisible();
    fireEvent.click(screen.getByText("Delete this session now"));
    const deleteButton = screen.getByRole("button", {
      name: "Delete session permanently",
    });
    expect(deleteButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /delete all data in this session/u,
      }),
    );
    fireEvent.click(deleteButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/sessions/session-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
