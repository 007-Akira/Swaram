import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LyricsEditor } from "./lyrics-editor";

const initialLines = [
  {
    id: "line-1",
    text: "മഴവില്ല്",
    start_ms: null,
    end_ms: null,
    is_stanza_break: false,
  },
  {
    id: "line-2",
    text: "കൺമണി",
    start_ms: null,
    end_ms: null,
    is_stanza_break: false,
  },
];

describe("LyricsEditor", () => {
  beforeEach(() => {
    window.sessionStorage.setItem("swaram:session-1:token", "private-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ lines: initialLines }),
      }),
    );
  });

  it("loads Malayalam lines and exposes editing operations", async () => {
    render(<LyricsEditor sessionId="session-1" />);
    await screen.findByDisplayValue("മഴവില്ല്");
    fireEvent.click(screen.getAllByRole("button", { name: "+ വരി" })[0]!);
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("വരി 1"), {
      target: { value: "മഴവില്ലിന്നേഴാം വർണ്ണം" },
    });
    expect(
      screen.getByText("സേവ് ചെയ്യാത്ത മാറ്റങ്ങളുണ്ട്."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "ഇപ്പോൾ സേവ് ചെയ്യുക" }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/session-1/lyrics"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });
});
