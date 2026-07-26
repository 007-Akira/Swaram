import {
  AnalysisPackageV1Schema,
  type AnalysisPackageV1,
} from "@swaram/contracts";

export interface TimedLyric {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

const LRC_LINE = /^\[(\d{2}):(\d{2})\.(\d{2})\](.+)$/u;

export function parseLrc(value: string, durationMs: number): TimedLyric[] {
  const starts = value
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const match = LRC_LINE.exec(line);
      if (!match) {
        throw new Error(`Invalid LRC line: ${line}`);
      }
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const centiseconds = Number(match[3]);
      const text = match[4]?.normalize("NFC").trim() ?? "";
      if (seconds >= 60 || !text) {
        throw new Error(`Invalid LRC line: ${line}`);
      }
      return {
        startMs: (minutes * 60 + seconds) * 1_000 + centiseconds * 10,
        text,
      };
    });
  return starts.map((line, index) => ({
    ...line,
    endMs: starts[index + 1]?.startMs ?? durationMs,
  }));
}

export async function loadPrototypeData(): Promise<{
  analysis: AnalysisPackageV1;
  lyrics: TimedLyric[];
}> {
  const [analysisResponse, lyricsResponse] = await Promise.all([
    fetch("/api/prototype-media/analysis", { cache: "no-store" }),
    fetch("/api/prototype-media/lyrics", { cache: "no-store" }),
  ]);
  if (!analysisResponse.ok || !lyricsResponse.ok) {
    throw new Error("prototype_media_unavailable");
  }
  const analysis = AnalysisPackageV1Schema.parse(await analysisResponse.json());
  const lyrics = parseLrc(
    await lyricsResponse.text(),
    Math.round(analysis.duration_seconds * 1_000),
  );
  return { analysis, lyrics };
}
