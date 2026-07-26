import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionPrivacyControls } from "./session-privacy-controls";

describe("SessionPrivacyControls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("discloses retention and requires confirmation before private deletion", async () => {
    window.sessionStorage.setItem("swaram:session-1:token", "secret");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionPrivacyControls sessionId="session-1" />);

    expect(screen.getByText(/24 മണിക്കൂറിന് ശേഷം/u)).toBeVisible();
    fireEvent.click(screen.getByText("ഈ സെഷൻ ഇപ്പോൾ ഇല്ലാതാക്കുക"));
    const deleteButton = screen.getByRole("button", {
      name: "സെഷൻ ശാശ്വതമായി ഇല്ലാതാക്കുക",
    });
    expect(deleteButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /എല്ലാ ഡാറ്റയും ഇല്ലാതാക്കണമെന്ന്/u,
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
