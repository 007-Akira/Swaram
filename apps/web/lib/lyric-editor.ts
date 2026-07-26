export interface EditableLyricLine {
  id: string;
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  is_stanza_break: boolean;
}

export function newLine(text = ""): EditableLyricLine {
  return {
    id: crypto.randomUUID(),
    text: text.normalize("NFC"),
    start_ms: null,
    end_ms: null,
    is_stanza_break: text.length === 0,
  };
}

export function insertLine(
  lines: readonly EditableLyricLine[],
  index: number,
): EditableLyricLine[] {
  const result = [...lines];
  result.splice(index + 1, 0, newLine());
  return result;
}

export function splitLine(
  lines: readonly EditableLyricLine[],
  index: number,
  offset: number,
): EditableLyricLine[] {
  const source = lines[index];
  if (!source) return [...lines];
  const result = [...lines];
  result.splice(
    index,
    1,
    { ...source, text: source.text.slice(0, offset).normalize("NFC") },
    newLine(source.text.slice(offset)),
  );
  return result;
}

export function mergeWithNext(
  lines: readonly EditableLyricLine[],
  index: number,
): EditableLyricLine[] {
  const current = lines[index];
  const next = lines[index + 1];
  if (!current || !next) return [...lines];
  const result = [...lines];
  result.splice(index, 2, {
    ...current,
    text: `${current.text}${current.text && next.text ? " " : ""}${next.text}`.normalize(
      "NFC",
    ),
    end_ms: next.end_ms,
    is_stanza_break: false,
  });
  return result;
}

export function moveLine(
  lines: readonly EditableLyricLine[],
  index: number,
  direction: -1 | 1,
): EditableLyricLine[] {
  const destination = index + direction;
  if (destination < 0 || destination >= lines.length) return [...lines];
  const result = [...lines];
  [result[index], result[destination]] = [
    result[destination]!,
    result[index]!,
  ];
  return result;
}

export function deleteLine(
  lines: readonly EditableLyricLine[],
  index: number,
): EditableLyricLine[] {
  return lines.filter((_line, lineIndex) => lineIndex !== index);
}

export function graphemeCount(text: string): number {
  const segmenter = new Intl.Segmenter("ml", { granularity: "grapheme" });
  return Array.from(segmenter.segment(text)).length;
}

export function validateEditableLines(
  lines: readonly EditableLyricLine[],
): string[] {
  const errors: string[] = [];
  if (!lines.some((line) => !line.is_stanza_break && line.text.trim())) {
    errors.push("കുറഞ്ഞത് ഒരു വരിയെങ്കിലും ആവശ്യമാണ്.");
  }
  lines.forEach((line, index) => {
    if (!line.is_stanza_break && !line.text.trim()) {
      errors.push(`വരി ${index + 1} ശൂന്യമാണ്.`);
    }
  });
  return errors;
}
