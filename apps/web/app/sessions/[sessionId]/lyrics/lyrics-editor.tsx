"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type EditableLyricLine,
  deleteLine,
  graphemeCount,
  insertLine,
  mergeWithNext,
  moveLine,
  splitLine,
  validateEditableLines,
} from "../../../../lib/lyric-editor";
import {
  markLineAt,
  nextLyricIndex,
  nudgeLine,
  previousLyricIndex,
  resetTimings,
} from "../../../../lib/lyric-sync";
import { LyricWaveform } from "./lyric-waveform";
import { ReadinessPanel } from "./readiness-panel";
import { SessionPrivacyControls } from "../../session-privacy-controls";
import { SessionUnavailable } from "../../../components/session-unavailable";
import {
  unavailableVariant,
  type SessionUnavailableVariant,
} from "../../../../lib/session-access";

interface Props {
  sessionId: string;
}

export function LyricsEditor({ sessionId }: Props) {
  const [lines, setLines] = useState<EditableLyricLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("Loading lyrics…");
  const [selectedLine, setSelectedLine] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(true);
  const [saveVersion, setSaveVersion] = useState(0);
  const [unavailable, setUnavailable] =
    useState<SessionUnavailableVariant | null>(null);
  const loaded = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const history = useRef<EditableLyricLine[][]>([]);

  const token =
    typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(`swaram:${sessionId}:token`);

  useEffect(() => {
    if (!token)
      queueMicrotask(() => setUnavailable(unavailableVariant(sessionId)));
  }, [sessionId, token]);

  const save = useCallback(async () => {
    if (!token) {
      setStatus("The private access token for this session is unavailable.");
      return;
    }
    const errors = validateEditableLines(lines);
    if (errors.length) {
      setStatus(errors[0]!);
      return;
    }
    setStatus("Saving…");
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}/lyrics`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": token,
        },
        body: JSON.stringify({ lines }),
      },
    );
    if (!response.ok) {
      setStatus("The lyrics could not be saved. Check them for errors.");
      return;
    }
    const payload = (await response.json()) as { lines: EditableLyricLine[] };
    setLines(payload.lines);
    setDirty(false);
    setSaveVersion((version) => version + 1);
    setStatus("All changes saved.");
  }, [lines, sessionId, token]);

  useEffect(() => {
    if (!token || loaded.current) return;
    loaded.current = true;
    void fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}/lyrics`,
      { headers: { "X-Session-Token": token } },
    )
      .then(async (response) => {
        if (!response.ok) {
          setUnavailable(unavailableVariant(sessionId, response));
          throw new Error("lyrics unavailable");
        }
        return (await response.json()) as { lines: EditableLyricLine[] };
      })
      .then((payload) => {
        setLines(payload.lines);
        setStatus("No unsaved changes.");
      })
      .catch(() => setStatus("The lyrics could not be loaded."));
  }, [sessionId, token]);

  useEffect(() => {
    if (!token) return;
    let objectUrl: string | null = null;
    void fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}`,
      { headers: { "X-Session-Token": token } },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("session unavailable");
        return (await response.json()) as {
          assets: Array<{ id: string; kind: string }>;
        };
      })
      .then(async (session) => {
        const asset = session.assets.find(
          (item) =>
            item.kind === "original_audio" || item.kind === "instrumental",
        );
        if (!asset) return;
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}/assets/${asset.id}/playback`,
          { headers: { "X-Session-Token": token } },
        );
        if (!response.ok) throw new Error("playback unavailable");
        objectUrl = URL.createObjectURL(await response.blob());
        setAudioUrl(objectUrl);
      })
      .catch(() => setStatus("The private audio could not be loaded."));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId, token]);

  useEffect(() => {
    if (!dirty) return;
    const timeout = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timeout);
  }, [dirty, save]);

  const change = useCallback((next: EditableLyricLine[]) => {
    setLines(next);
    setDirty(true);
    setStatus("You have unsaved changes.");
  }, []);

  const timingChange = useCallback(
    (next: EditableLyricLine[]) => {
      history.current.push(lines.map((line) => ({ ...line })));
      change(next);
    },
    [change, lines],
  );

  const waveformChange = useCallback((next: EditableLyricLine[]) => {
    setLines((current) => {
      history.current.push(current.map((line) => ({ ...line })));
      return next;
    });
    setDirty(true);
    setStatus("You have unsaved marker changes.");
  }, []);
  const waveformError = useCallback(
    (message: string) => setStatus(message),
    [],
  );

  const markCurrentLine = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !durationMs) {
      setStatus("The audio is not ready.");
      return;
    }
    try {
      timingChange(
        markLineAt(lines, selectedLine, audio.currentTime * 1000, durationMs),
      );
      setSelectedLine(nextLyricIndex(lines, selectedLine));
    } catch {
      setStatus("Markers must remain in chronological order.");
    }
  }, [durationMs, lines, selectedLine, timingChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (
        event.code === "Space" &&
        !["TEXTAREA", "INPUT"].includes(element?.tagName ?? "")
      ) {
        event.preventDefault();
        markCurrentLine();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [markCurrentLine]);

  if (unavailable) {
    return (
      <SessionUnavailable
        onRetry={() => window.location.reload()}
        variant={unavailable}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#07130f] px-4 py-8 text-[#f1faf5]">
      <section className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-emerald-300">Private song session</p>
            <h1 className="text-3xl font-semibold">Prepare your lyrics</h1>
            <p aria-live="polite" className="mt-2 text-sm text-slate-300">
              {status}
            </p>
          </div>
          <button
            className="rounded-lg bg-emerald-400 px-5 py-3 font-semibold text-[#07130f]"
            onClick={() => void save()}
            type="button"
          >
            Save now
          </button>
        </header>

        <ReadinessPanel
          refreshKey={saveVersion}
          sessionId={sessionId}
          token={token}
        />

        <section className="mb-6 rounded-xl border border-cyan-900 bg-[#0b1d23] p-4">
          <h2 className="text-xl font-semibold">Mark lyric timing</h2>
          {showInstructions && (
            <div className="mt-2 rounded-lg bg-cyan-950/60 p-3 text-sm">
              Play the audio and press Space, or select “Mark line,” when each
              lyric line begins. End times are calculated automatically from the
              start of the next line.
              <button
                className="ml-3 underline"
                onClick={() => setShowInstructions(false)}
                type="button"
              >
                Got it
              </button>
            </div>
          )}
          <audio
            className="mt-3 w-full"
            controls
            onLoadedMetadata={(event) =>
              setDurationMs(Math.round(event.currentTarget.duration * 1000))
            }
            ref={audioRef}
            src={audioUrl ?? undefined}
          />
          {audioUrl && (
            <div className="mt-4">
              <LyricWaveform
                audioUrl={audioUrl}
                lines={lines}
                onError={waveformError}
                onLinesChange={waveformChange}
                onSelectLine={setSelectedLine}
              />
            </div>
          )}
          <p className="mt-2 text-sm text-cyan-200">
            Current line: {selectedLine + 1}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={markCurrentLine} type="button">
              Mark line
            </button>
            <button
              onClick={() => {
                const previous = history.current.pop();
                if (previous) change(previous);
              }}
              type="button"
            >
              Undo
            </button>
            <button
              onClick={() =>
                setSelectedLine(previousLyricIndex(lines, selectedLine))
              }
              type="button"
            >
              ← Previous line
            </button>
            <button
              onClick={() =>
                setSelectedLine(nextLyricIndex(lines, selectedLine))
              }
              type="button"
            >
              Next line →
            </button>
            {([-250, -100, -50, 50, 100, 250] as const).map((delta) => (
              <button
                key={delta}
                onClick={() => {
                  try {
                    timingChange(
                      nudgeLine(lines, selectedLine, delta, durationMs),
                    );
                  } catch {
                    setStatus("Markers cannot cross each other.");
                  }
                }}
                type="button"
              >
                {delta > 0 ? "+" : ""}
                {delta} ms
              </button>
            ))}
            <button
              onClick={() => {
                const line = lines[selectedLine];
                if (
                  audioRef.current &&
                  line?.start_ms !== null &&
                  line?.start_ms !== undefined
                ) {
                  audioRef.current.currentTime = line.start_ms / 1000;
                  void audioRef.current.play();
                }
              }}
              type="button"
            >
              Replay line
            </button>
            <button
              onClick={() => timingChange(resetTimings(lines))}
              type="button"
            >
              Reset timing
            </button>
          </div>
        </section>

        <ol className="space-y-3" aria-label="Song lyrics">
          {lines.map((line, index) => (
            <li
              className={`rounded-xl border p-3 ${
                line.is_stanza_break
                  ? "border-dashed border-slate-600 bg-slate-900/30"
                  : "border-emerald-900 bg-[#10231c]"
              }`}
              key={line.id}
              onClick={() => setSelectedLine(index)}
            >
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">
                  Line {index + 1} · {graphemeCount(line.text)} characters
                </span>
                <textarea
                  aria-label={`Line ${index + 1}`}
                  className="min-h-16 w-full resize-y rounded-lg bg-[#081711] p-3 text-lg outline-none focus:ring-2 focus:ring-emerald-400"
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = {
                      ...line,
                      text: event.target.value.normalize("NFC"),
                      is_stanza_break: event.target.value.length === 0,
                    };
                    change(next);
                  }}
                  value={line.text}
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => change(insertLine(lines, index))}
                  type="button"
                >
                  + Line
                </button>
                <button
                  onClick={() =>
                    change(
                      splitLine(lines, index, Math.floor(line.text.length / 2)),
                    )
                  }
                  type="button"
                >
                  Split
                </button>
                <button
                  onClick={() => change(mergeWithNext(lines, index))}
                  type="button"
                >
                  Merge with next
                </button>
                <button
                  onClick={() => change(moveLine(lines, index, -1))}
                  type="button"
                >
                  ↑
                </button>
                <button
                  onClick={() => change(moveLine(lines, index, 1))}
                  type="button"
                >
                  ↓
                </button>
                <button
                  onClick={() => change(deleteLine(lines, index))}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
        <SessionPrivacyControls sessionId={sessionId} />
      </section>
    </main>
  );
}
