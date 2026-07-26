import { describe, expect, it } from "vitest";

import { parseLrc } from "./prototype-data";

describe("parseLrc", () => {
  it("parses and bounds NFC Malayalam lyric lines", () => {
    const lines = parseLrc(
      "[00:04.73]ദൂരെ ഒരു മഴവില്ല്\n[00:09.85]തൂവൽ കവിളിണയിൽ",
      12_000,
    );
    expect(lines).toEqual([
      {
        startMs: 4_730,
        endMs: 9_850,
        text: "ദൂരെ ഒരു മഴവില്ല്",
      },
      {
        startMs: 9_850,
        endMs: 12_000,
        text: "തൂവൽ കവിളിണയിൽ",
      },
    ]);
  });

  it("rejects malformed timestamps", () => {
    expect(() => parseLrc("not timed", 1_000)).toThrow(/Invalid LRC/);
  });
});
