"use client";

export interface PracticeLyricLine {
  readonly id: string;
  readonly text: string;
  readonly start_ms: number | null;
  readonly end_ms: number | null;
  readonly is_stanza_break: boolean;
}

export function activeLyricIndex(
  lines: readonly PracticeLyricLine[],
  timeMs: number,
): number {
  return lines.findIndex(
    (line) =>
      !line.is_stanza_break &&
      line.start_ms !== null &&
      line.end_ms !== null &&
      timeMs >= line.start_ms &&
      timeMs < line.end_ms,
  );
}

export function lyricWindow(
  lines: readonly PracticeLyricLine[],
  activeIndex: number,
): readonly PracticeLyricLine[] {
  const singable = lines.filter((line) => !line.is_stanza_break);
  if (singable.length === 0) return [];
  const activeId = lines[activeIndex]?.id;
  const singableIndex = singable.findIndex(({ id }) => id === activeId);
  if (singableIndex < 0) return singable.slice(0, 3);
  return singable.slice(
    Math.max(0, singableIndex - 1),
    Math.min(singable.length, singableIndex + 2),
  );
}

interface Props {
  readonly lines: readonly PracticeLyricLine[];
  readonly currentTimeMs: number;
  readonly isPlaying: boolean;
  readonly onSeek: (timeMs: number) => void;
  readonly confirmSeek?: () => boolean;
}

export function PracticeLyrics({
  lines,
  currentTimeMs,
  isPlaying,
  onSeek,
  confirmSeek = () =>
    window.confirm("Practice is in progress. Jump to this line?"),
}: Props) {
  const activeIndex = activeLyricIndex(lines, currentTimeMs);
  const visible = lyricWindow(lines, activeIndex);
  if (visible.length === 0) {
    return <p>Timed lyrics are unavailable for this practice session.</p>;
  }
  const activeId = lines[activeIndex]?.id;
  return (
    <section
      aria-label="Timed lyrics"
      className="my-5 space-y-2 text-center"
      style={{
        fontFamily:
          '"Noto Sans Malayalam", "Nirmala UI", "Kartika", system-ui, sans-serif',
      }}
    >
      {visible.map((line) => {
        const current = line.id === activeId;
        return (
          <button
            aria-current={current ? "true" : undefined}
            className={`block w-full rounded-lg p-3 text-wrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
              current
                ? "bg-emerald-300 text-xl font-semibold text-slate-950"
                : "bg-slate-900 text-slate-300"
            }`}
            key={line.id}
            onClick={() => {
              if (line.start_ms === null) return;
              if (!isPlaying || confirmSeek()) onSeek(line.start_ms);
            }}
            type="button"
          >
            {line.text}
          </button>
        );
      })}
    </section>
  );
}
