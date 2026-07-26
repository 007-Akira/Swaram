import type { EditableLyricLine } from "./lyric-editor";

export function deriveEndTimes(
  lines: readonly EditableLyricLine[],
  durationMs: number,
): EditableLyricLine[] {
  const next = lines.map((line) => ({ ...line }));
  const timedIndices = next
    .map((line, index) => (!line.is_stanza_break && line.start_ms !== null ? index : -1))
    .filter((index) => index >= 0);
  timedIndices.forEach((lineIndex, position) => {
    const followingIndex = timedIndices[position + 1];
    next[lineIndex]!.end_ms =
      followingIndex === undefined
        ? durationMs
        : next[followingIndex]!.start_ms;
  });
  return next;
}

export function markLineAt(
  lines: readonly EditableLyricLine[],
  index: number,
  timeMs: number,
  durationMs: number,
): EditableLyricLine[] {
  const rounded = Math.max(0, Math.min(durationMs, Math.round(timeMs)));
  const previous = [...lines]
    .slice(0, index)
    .reverse()
    .find((line) => !line.is_stanza_break && line.start_ms !== null);
  const following = lines
    .slice(index + 1)
    .find((line) => !line.is_stanza_break && line.start_ms !== null);
  if (
    (previous?.start_ms !== null &&
      previous?.start_ms !== undefined &&
      rounded <= previous.start_ms) ||
    (following?.start_ms !== null &&
      following?.start_ms !== undefined &&
      rounded >= following.start_ms)
  ) {
    throw new Error("Lyric markers must remain ordered");
  }
  const result = lines.map((line) => ({ ...line }));
  const target = result[index];
  if (!target || target.is_stanza_break) return result;
  target.start_ms = rounded;
  return deriveEndTimes(result, durationMs);
}

export function nudgeLine(
  lines: readonly EditableLyricLine[],
  index: number,
  deltaMs: number,
  durationMs: number,
): EditableLyricLine[] {
  const line = lines[index];
  if (!line || line.start_ms === null) return [...lines];
  return markLineAt(lines, index, line.start_ms + deltaMs, durationMs);
}

export function resetTimings(
  lines: readonly EditableLyricLine[],
): EditableLyricLine[] {
  return lines.map((line) => ({ ...line, start_ms: null, end_ms: null }));
}

export function nextLyricIndex(
  lines: readonly EditableLyricLine[],
  current: number,
): number {
  for (let index = current + 1; index < lines.length; index += 1) {
    if (!lines[index]!.is_stanza_break) return index;
  }
  return current;
}

export function previousLyricIndex(
  lines: readonly EditableLyricLine[],
  current: number,
): number {
  for (let index = current - 1; index >= 0; index -= 1) {
    if (!lines[index]!.is_stanza_break) return index;
  }
  return current;
}
