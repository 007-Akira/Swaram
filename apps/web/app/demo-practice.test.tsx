import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoPractice } from "./demo-practice";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("DemoPractice", () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("stores private demo access and opens practice", () => {
    render(<DemoPractice sessionId="demo-session" token="private-token" />);
    fireEvent.click(
      screen.getByRole("button", { name: /practice demo song/i }),
    );
    expect(window.sessionStorage.getItem("swaram:demo-session:token")).toBe(
      "private-token",
    );
    expect(push).toHaveBeenCalledWith("/sessions/demo-session/practice");
    expect(screen.queryByText("private-token")).not.toBeInTheDocument();
  });
});
