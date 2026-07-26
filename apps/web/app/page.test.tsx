import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      screen.getByRole("heading", { name: /find the note/i }),
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
});
