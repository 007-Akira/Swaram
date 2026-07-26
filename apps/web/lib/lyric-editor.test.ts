import { describe, expect, it, vi } from "vitest";

import {
  deleteLine,
  graphemeCount,
  insertLine,
  mergeWithNext,
  moveLine,
  newLine,
  splitLine,
} from "./lyric-editor";

vi.stubGlobal("crypto", { randomUUID: () => "generated-id" });

describe("Malayalam lyric editing operations", () => {
  it("adds, splits, merges, reorders, and deletes without damaging text", () => {
    const original = [newLine("മഴവില്ല്"), newLine("കൺമണി")];
    expect(insertLine(original, 0)[1]?.is_stanza_break).toBe(true);
    const split = splitLine(original, 0, 2);
    expect(split.map((line) => line.text).join("")).toBe("മഴവില്ല്കൺമണി");
    const merged = mergeWithNext(original, 0);
    expect(merged[0]?.text).toBe("മഴവില്ല് കൺമണി");
    expect(moveLine(original, 1, -1)[0]?.text).toBe("കൺമണി");
    expect(deleteLine(original, 0)[0]?.text).toBe("കൺമണി");
  });

  it("counts Malayalam grapheme clusters rather than UTF-16 units", () => {
    expect(graphemeCount("കാ")).toBe(1);
    expect(graphemeCount("കൺ")).toBe(2);
    expect(graphemeCount("മഴ")).toBe(2);
  });
});
