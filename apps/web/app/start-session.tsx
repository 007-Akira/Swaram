"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Stage = "idle" | "creating" | "audio" | "lyrics" | "ready";

interface SessionCreated {
  id: string;
  access_token: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function messageFrom(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = "detail" in payload ? payload.detail : null;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) {
    const message = detail.message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

async function checkedJson<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(messageFrom(payload, fallback));
  return payload as T;
}

export function StartSession() {
  const router = useRouter();
  const lyricsFileRef = useRef<HTMLInputElement>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [lyricsFile, setLyricsFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");

  const busy = stage !== "idle";
  const stageLabel: Record<Stage, string> = {
    idle: "Create private practice",
    creating: "Creating private room…",
    audio: "Uploading audio…",
    lyrics: "Preparing lyrics…",
    ready: "Opening editor…",
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!audio || (!lyrics.trim() && !lyricsFile)) {
      setError("Add one audio file and either paste or upload the lyrics.");
      return;
    }

    setError("");
    setStage("creating");
    try {
      const created = await checkedJson<SessionCreated>(
        await fetch(`${apiUrl}/api/v1/sessions`, { method: "POST" }),
        "Could not create a private session.",
      );
      window.sessionStorage.setItem(
        `swaram:${created.id}:token`,
        created.access_token,
      );

      setStage("audio");
      const audioBody = new FormData();
      audioBody.append("audio", audio);
      await checkedJson(
        await fetch(`${apiUrl}/api/v1/sessions/${created.id}/audio`, {
          method: "POST",
          headers: { "X-Session-Token": created.access_token },
          body: audioBody,
        }),
        "The audio could not be uploaded. Check its format and size.",
      );

      setStage("lyrics");
      const lyricsBody = new FormData();
      if (lyricsFile) lyricsBody.append("lyrics", lyricsFile);
      else lyricsBody.append("text", lyrics.trim());
      await checkedJson(
        await fetch(`${apiUrl}/api/v1/sessions/${created.id}/lyrics`, {
          method: "POST",
          headers: { "X-Session-Token": created.access_token },
          body: lyricsBody,
        }),
        "The lyrics could not be prepared.",
      );

      setStage("ready");
      router.push(`/sessions/${created.id}/lyrics`);
    } catch (reason) {
      setStage("idle");
      setError(
        reason instanceof Error
          ? reason.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  return (
    <section
      aria-labelledby="start-title"
      className="relative rounded-[2rem] border border-white/10 bg-[#0b1915]/95 p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-7"
    >
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
            Start here
          </p>
          <h2 className="mt-2 text-2xl font-semibold" id="start-title">
            Set up your practice
          </h2>
        </div>
        <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-3 py-1 text-[11px] text-emerald-100/80">
          Private · 24h
        </span>
      </div>

      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="audio">
            1. Song audio
          </label>
          <label
            className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-emerald-200/20 bg-black/15 p-4 transition-colors hover:border-emerald-200/45"
            htmlFor="audio"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-300/10 text-xl text-emerald-200">
              ↑
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {audio?.name ?? "Choose an audio file"}
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                MP3, WAV, M4A or FLAC
              </span>
            </span>
          </label>
          <input
            accept=".mp3,.wav,.m4a,.flac,audio/mpeg,audio/wav,audio/mp4,audio/flac"
            className="sr-only"
            disabled={busy}
            id="audio"
            name="audio"
            onChange={(event) => setAudio(event.target.files?.[0] ?? null)}
            type="file"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="block text-sm font-medium" htmlFor="lyrics">
              2. Lyrics
            </label>
            <span className="text-[11px] text-slate-500">
              Malayalam Unicode
            </span>
          </div>
          <textarea
            className="min-h-28 w-full resize-y rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-300/50 focus:ring-2 focus:ring-emerald-300/10"
            disabled={busy || Boolean(lyricsFile)}
            id="lyrics"
            onChange={(event) => setLyrics(event.target.value)}
            placeholder={
              "Paste one lyric line at a time…\n\nBlank lines create stanzas."
            }
            value={lyrics}
          />
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span>or</span>
            <label
              className="cursor-pointer font-medium text-emerald-300 underline decoration-emerald-300/30 underline-offset-4"
              htmlFor="lyrics-file"
            >
              {lyricsFile ? lyricsFile.name : "upload TXT, LRC or SRT"}
            </label>
            {lyricsFile && (
              <button
                className="min-h-0 p-1 text-slate-400 underline"
                onClick={() => {
                  setLyricsFile(null);
                  if (lyricsFileRef.current) lyricsFileRef.current.value = "";
                }}
                type="button"
              >
                remove
              </button>
            )}
          </div>
          <input
            accept=".txt,.lrc,.srt,text/plain,application/x-subrip"
            className="sr-only"
            disabled={busy}
            id="lyrics-file"
            onChange={(event) => {
              setLyricsFile(event.target.files?.[0] ?? null);
              setLyrics("");
            }}
            ref={lyricsFileRef}
            type="file"
          />
        </div>

        {error && (
          <p
            aria-live="assertive"
            className="rounded-xl border border-rose-300/15 bg-rose-400/[.07] px-4 py-3 text-sm text-rose-100"
          >
            {error}
          </p>
        )}

        <button
          className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-300 px-5 py-4 font-semibold text-[#07130f] shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-200 disabled:hover:bg-emerald-300"
          disabled={busy}
          type="submit"
        >
          {stageLabel[stage]}
          {!busy && (
            <span
              aria-hidden="true"
              className="transition-transform group-hover:translate-x-1"
            >
              →
            </span>
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-[11px] leading-5 text-slate-500">
        Uploads are private and expire automatically. Microphone audio remains
        in your browser.
      </p>
    </section>
  );
}
