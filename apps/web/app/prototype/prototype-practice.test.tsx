import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PrototypePractice } from "./prototype-practice";

vi.mock("../../lib/prototype-data", () => ({
  loadPrototypeData: vi.fn().mockRejectedValue(new Error("missing")),
}));

describe("PrototypePractice", () => {
  it("shows a clear private-media error state", async () => {
    render(<PrototypePractice />);
    expect(
      screen.getByText("പരിശീലന മാതൃക ലോഡ് ചെയ്യുന്നു…"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "പരിശീലന മാതൃക ലഭ്യമല്ല" }),
      ).toBeInTheDocument();
    });
  });
});
