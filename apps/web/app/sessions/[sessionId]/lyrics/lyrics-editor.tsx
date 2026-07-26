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

interface Props {
  sessionId: string;
}

export function LyricsEditor({ sessionId }: Props) {
  const [lines, setLines] = useState<EditableLyricLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("വരികൾ ലോഡ് ചെയ്യുന്നു…");
  const loaded = useRef(false);

  const token =
    typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(`swaram:${sessionId}:token`);

  const save = useCallback(async () => {
    if (!token) {
      setStatus("ഈ സെഷന്റെ സ്വകാര്യ ആക്‌സസ് ടോക്കൺ ലഭ്യമല്ല.");
      return;
    }
    const errors = validateEditableLines(lines);
    if (errors.length) {
      setStatus(errors[0]!);
      return;
    }
    setStatus("സേവ് ചെയ്യുന്നു…");
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
      setStatus("വരികൾ സേവ് ചെയ്യാനായില്ല. പിശകുകൾ പരിശോധിക്കുക.");
      return;
    }
    const payload = (await response.json()) as { lines: EditableLyricLine[] };
    setLines(payload.lines);
    setDirty(false);
    setStatus("എല്ലാ മാറ്റങ്ങളും സേവ് ചെയ്തു.");
  }, [lines, sessionId, token]);

  useEffect(() => {
    if (!token || loaded.current) return;
    loaded.current = true;
    void fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}/lyrics`,
      { headers: { "X-Session-Token": token } },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("lyrics unavailable");
        return (await response.json()) as { lines: EditableLyricLine[] };
      })
      .then((payload) => {
        setLines(payload.lines);
        setStatus("മാറ്റങ്ങളൊന്നുമില്ല.");
      })
      .catch(() => setStatus("വരികൾ ലോഡ് ചെയ്യാനായില്ല."));
  }, [sessionId, token]);

  useEffect(() => {
    if (!dirty) return;
    const timeout = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timeout);
  }, [dirty, save]);

  const change = (next: EditableLyricLine[]) => {
    setLines(next);
    setDirty(true);
    setStatus("സേവ് ചെയ്യാത്ത മാറ്റങ്ങളുണ്ട്.");
  };

  return (
    <main className="min-h-screen bg-[#07130f] px-4 py-8 text-[#f1faf5]">
      <section className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-emerald-300">സ്വകാര്യ ഗാന സെഷൻ</p>
            <h1 className="text-3xl font-semibold">വരികൾ തയ്യാറാക്കുക</h1>
            <p aria-live="polite" className="mt-2 text-sm text-slate-300">
              {status}
            </p>
          </div>
          <button
            className="rounded-lg bg-emerald-400 px-5 py-3 font-semibold text-[#07130f]"
            onClick={() => void save()}
            type="button"
          >
            ഇപ്പോൾ സേവ് ചെയ്യുക
          </button>
        </header>

        <ol className="space-y-3" aria-label="മലയാളം ഗാനവരികൾ">
          {lines.map((line, index) => (
            <li
              className={`rounded-xl border p-3 ${
                line.is_stanza_break
                  ? "border-dashed border-slate-600 bg-slate-900/30"
                  : "border-emerald-900 bg-[#10231c]"
              }`}
              key={line.id}
            >
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">
                  വരി {index + 1} · {graphemeCount(line.text)} അക്ഷരങ്ങൾ
                </span>
                <textarea
                  aria-label={`വരി ${index + 1}`}
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
                <button onClick={() => change(insertLine(lines, index))} type="button">
                  + വരി
                </button>
                <button
                  onClick={() => change(splitLine(lines, index, Math.floor(line.text.length / 2)))}
                  type="button"
                >
                  വിഭജിക്കുക
                </button>
                <button onClick={() => change(mergeWithNext(lines, index))} type="button">
                  അടുത്തതുമായി ചേർക്കുക
                </button>
                <button onClick={() => change(moveLine(lines, index, -1))} type="button">
                  ↑
                </button>
                <button onClick={() => change(moveLine(lines, index, 1))} type="button">
                  ↓
                </button>
                <button onClick={() => change(deleteLine(lines, index))} type="button">
                  നീക്കുക
                </button>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
