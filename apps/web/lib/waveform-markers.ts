import type { EditableLyricLine } from "./lyric-editor";

export interface LyricMarker {
  lineId: string;
  lineIndex: number;
  startSeconds: number;
  endSeconds: number;
  label: string;
}

export function linesToMarkers(
  lines: readonly EditableLyricLine[],
): LyricMarker[] {
  return lines.flatMap((line, lineIndex) =>
    line.is_stanza_break ||
    line.start_ms === null ||
    line.end_ms === null ||
    line.end_ms <= line.start_ms
      ? []
      : [
          {
            lineId: line.id,
            lineIndex,
            startSeconds: line.start_ms / 1000,
            endSeconds: line.end_ms / 1000,
            label: line.text,
          },
        ],
  );
}

export function updateLineFromMarker(
  lines: readonly EditableLyricLine[],
  lineId: string,
  startSeconds: number,
): EditableLyricLine[] {
  const index = lines.findIndex((line) => line.id === lineId);
  if (index < 0) return [...lines];
  let previousIndex = -1;
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if (
      !lines[candidate]!.is_stanza_break &&
      lines[candidate]!.start_ms !== null
    ) {
      previousIndex = candidate;
      break;
    }
  }
  const previous = previousIndex >= 0 ? lines[previousIndex] : undefined;
  const following = lines
    .slice(index + 1)
    .find((line) => !line.is_stanza_break && line.start_ms !== null);
  const startMs = Math.round(startSeconds * 1000);
  if (
    startMs < 0 ||
    (previous?.start_ms !== null &&
      previous?.start_ms !== undefined &&
      startMs <= previous.start_ms) ||
    (following?.start_ms !== null &&
      following?.start_ms !== undefined &&
      startMs >= following.start_ms)
  ) {
    throw new Error("Marker would make lyric timing invalid");
  }
  const result = lines.map((line) => ({ ...line }));
  result[index]!.start_ms = startMs;
  if (previousIndex >= 0) result[previousIndex]!.end_ms = startMs;
  return result;
}
