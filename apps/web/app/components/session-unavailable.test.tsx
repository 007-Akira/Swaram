import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionUnavailable } from "./session-unavailable";

describe("SessionUnavailable", () => {
  afterEach(cleanup);

  it.each([
    ["expired", "This private session has expired"],
    ["deleted", "This session has been deleted"],
    ["missing_token", "Private session access is missing"],
    ["invalid_token", "Private session access is invalid"],
  ] as const)("renders the %s variant", (variant, title) => {
    render(<SessionUnavailable variant={variant} />);
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText("Swaram")).toBeVisible();
    expect(screen.queryByText(/token.*:/i)).not.toBeInTheDocument();
  });
});
