import { describe, expect, it } from "vitest";

import { CONTRACTS_VERSION } from "./index.js";

describe("contracts package", () => {
  it("exports its baseline version", () => {
    expect(CONTRACTS_VERSION).toBe("0.0.0");
  });
});
