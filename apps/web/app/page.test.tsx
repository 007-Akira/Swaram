import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the Malayalam product name", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "സ്വരം" })).toBeInTheDocument();
  });
});
