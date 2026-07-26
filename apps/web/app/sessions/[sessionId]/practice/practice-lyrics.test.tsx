import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeLyricIndex,
  PracticeLyrics,
  type PracticeLyricLine,
} from "./practice-lyrics";

const lines: PracticeLyricLine[] = [
  {
    id: "first",
    text: "മഴ",
    start_ms: 0,
    end_ms: 1_000,
    is_stanza_break: false,
  },
  {
    id: "second",
    text: "മഴ",
    start_ms: 1_000,
    end_ms: 2_000,
    is_stanza_break: false,
  },
  {
    id: "third",
    text: "വാനം",
    start_ms: 2_000,
    end_ms: 3_000,
    is_stanza_break: false,
  },
];

describe("PracticeLyrics", () => {
  afterEach(() => cleanup());

  it("uses exact boundary timestamps and line identity for repeated text", () => {
    expect(activeLyricIndex(lines, 999)).toBe(0);
    expect(activeLyricIndex(lines, 1_000)).toBe(1);
    render(
      <PracticeLyrics
        currentTimeMs={1_000}
        isPlaying={false}
        lines={lines}
        onSeek={vi.fn()}
      />,
    );
    const repeated = screen.getAllByRole("button", { name: "മഴ" });
    expect(repeated[0]).not.toHaveAttribute("aria-current");
    expect(repeated[1]).toHaveAttribute("aria-current", "true");
  });

  it("seeks directly while paused and confirms during playback", () => {
    const onSeek = vi.fn();
    const confirmSeek = vi.fn(() => false);
    const { rerender } = render(
      <PracticeLyrics
        confirmSeek={confirmSeek}
        currentTimeMs={1_500}
        isPlaying={true}
        lines={lines}
        onSeek={onSeek}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "വാനം" }));
    expect(confirmSeek).toHaveBeenCalledOnce();
    expect(onSeek).not.toHaveBeenCalled();
    rerender(
      <PracticeLyrics
        currentTimeMs={1_500}
        isPlaying={false}
        lines={lines}
        onSeek={onSeek}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "വാനം" }));
    expect(onSeek).toHaveBeenCalledWith(2_000);
  });

  it("shows a no-lyrics fallback", () => {
    render(
      <PracticeLyrics
        currentTimeMs={0}
        isPlaying={false}
        lines={[]}
        onSeek={vi.fn()}
      />,
    );
    expect(screen.getByText(/വരികൾ ലഭ്യമല്ല/)).toBeInTheDocument();
  });
});
