"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { rememberSession } from "../lib/session-access";

type Stage = "idle" | "creating" | "audio" | "lyrics" | "ready";

interface SessionCreated {
  id: string;
  access_token: string;
  expires_at: string;
}

interface LyricsAccepted {
  job_id: string | null;
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
      rememberSession(created.id, {
        token: created.access_token,
        expiresAt: created.expires_at,
        songName: audio.name,
      });

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
      const accepted = await checkedJson<LyricsAccepted>(
        await fetch(`${apiUrl}/api/v1/sessions/${created.id}/lyrics`, {
          method: "POST",
          headers: { "X-Session-Token": created.access_token },
          body: lyricsBody,
        }),
        "The lyrics could not be prepared.",
      );

      if (!accepted.job_id) {
        throw new Error("Audio processing could not be started.");
      }
      rememberSession(created.id, {
        token: created.access_token,
        expiresAt: created.expires_at,
        songName: audio.name,
        jobId: accepted.job_id,
      });

      setStage("ready");
      router.push(`/sessions/${created.id}/processing`);
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
    <section id="start" aria-labelledby="start-title" className="scroll-mt-24">
      <h2 className="sr-only" id="start-title">
        Set up your practice
      </h2>
      <form onSubmit={(event) => void submit(event)}>
        <div className="grid items-start gap-6 md:grid-cols-2">
          <section className="flex flex-col gap-3">
            <label
              className="text-xs font-bold uppercase tracking-[0.12em] text-[#5a403c]"
              htmlFor="audio"
            >
              Reference audio
            </label>
            {audio ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-[#e3beb8] bg-white p-8 text-center">
                <span
                  aria-hidden="true"
                  className="grid size-14 place-items-center rounded bg-[#8b0000] text-2xl text-white"
                >
                  ♫
                </span>
                <p className="mt-4 max-w-full truncate font-medium">
                  {audio.name}
                </p>
                <p className="font-data mt-1 text-xs text-[#5a403c]">
                  {(audio.size / 1024 / 1024).toFixed(1)} MB
                </p>
                <button
                  className="mt-5 border border-[#8e706b] bg-transparent text-[#610000]"
                  disabled={busy}
                  onClick={() => setAudio(null)}
                  type="button"
                >
                  Choose another file
                </button>
              </div>
            ) : (
              <label
                className="flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#8e706b] bg-[#fff0ee] p-8 text-center transition-colors hover:bg-[#ffe9e6]"
                htmlFor="audio"
              >
                <span aria-hidden="true" className="text-4xl text-[#610000]">
                  ♬
                </span>
                <span className="mt-4 font-medium">
                  Choose your reference audio
                </span>
                <span className="mt-1 text-sm text-[#5a403c]">
                  Browse from your computer
                </span>
                <span className="mt-5 flex flex-wrap justify-center gap-2">
                  {["MP3", "WAV", "M4A", "FLAC"].map((format) => (
                    <span
                      className="rounded bg-[#f8dcd8] px-2 py-1 text-xs font-bold text-[#5a403c]"
                      key={format}
                    >
                      {format}
                    </span>
                  ))}
                </span>
              </label>
            )}
            <input
              accept=".mp3,.wav,.m4a,.flac,audio/mpeg,audio/wav,audio/mp4,audio/flac"
              className="sr-only"
              disabled={busy}
              id="audio"
              name="audio"
              onChange={(event) => setAudio(event.target.files?.[0] ?? null)}
              type="file"
            />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between border-b border-[#e3beb8]">
              <label
                className="border-b-2 border-[#8b0000] px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#610000]"
                htmlFor="lyrics"
              >
                Paste lyrics
              </label>
              <label
                className="cursor-pointer px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#5a403c] hover:text-[#610000]"
                htmlFor="lyrics-file"
              >
                Upload file
              </label>
            </div>
            <textarea
              className="malayalam-text min-h-[240px] w-full flex-1 resize-none border-0 border-b border-[#8e706b] bg-transparent px-1 py-3 text-lg text-[#261816] outline-none placeholder:text-[#8e706b] focus:border-[#8b0000] focus:ring-0"
              disabled={busy || Boolean(lyricsFile)}
              id="lyrics"
              onChange={(event) => setLyrics(event.target.value)}
              placeholder={
                "Paste one lyric line at a time…\n\nBlank lines create stanzas."
              }
              value={lyrics}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-[#5a403c]">
              <span>
                {lyricsFile
                  ? lyricsFile.name
                  : `${lyrics.length} characters · Malayalam Unicode`}
              </span>
              {lyricsFile && (
                <button
                  className="min-h-0 bg-transparent p-1 text-[#610000] underline"
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
          </section>
        </div>

        <ol
          className="mx-auto my-9 flex max-w-3xl items-start justify-between"
          aria-label="Session creation progress"
        >
          {[
            ["creating", "Creating"],
            ["audio", "Uploading"],
            ["lyrics", "Processing"],
            ["ready", "Preparing"],
          ].map(([key, label], index) => {
            const order = ["idle", "creating", "audio", "lyrics", "ready"];
            const current = order.indexOf(stage);
            const position = index + 1;
            const complete = current > position;
            const active = current === position;
            return (
              <li
                className="relative flex flex-1 flex-col items-center text-center"
                key={key}
              >
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className={`absolute right-1/2 top-3 h-px w-full ${complete || active ? "bg-[#8b0000]" : "bg-[#e3beb8]"}`}
                  />
                )}
                <span
                  className={`relative z-10 grid size-6 place-items-center rounded-full border-2 text-xs ${complete ? "border-[#8b0000] bg-[#8b0000] text-white" : active ? "border-[#8b0000] bg-[#fff8f6] text-[#8b0000]" : "border-[#e3beb8] bg-[#fff8f6] text-[#8e706b]"}`}
                >
                  {complete ? "✓" : active ? "•" : ""}
                </span>
                <span
                  className={`mt-2 text-[10px] font-bold uppercase tracking-wider ${complete || active ? "text-[#610000]" : "text-[#8e706b]"}`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>

        {error && (
          <p
            aria-live="assertive"
            className="mb-4 rounded border border-[#ba1a1a] bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]"
          >
            {error}
          </p>
        )}

        <section
          id="privacy"
          className="flex scroll-mt-24 flex-col items-center justify-between gap-6 rounded-lg border border-[#e3beb8] bg-[#fff0ee] p-6 md:flex-row"
        >
          <div className="flex max-w-2xl items-start gap-3">
            <span aria-hidden="true" className="text-2xl text-[#610000]">
              ◇
            </span>
            <div>
              <h3 className="font-medium">Acoustic privacy assured</h3>
              <p className="mt-1 text-sm leading-6 text-[#5a403c]">
                Microphone data is processed locally during practice. Uploaded
                reference files and lyrics are automatically removed after the
                session retention period.
              </p>
            </div>
          </div>
          <button
            className="w-full shrink-0 rounded bg-[#8b0000] px-8 py-4 font-semibold text-white shadow-[inset_0_-2px_0_rgba(0,0,0,.15)] hover:bg-[#610000] md:w-auto"
            disabled={busy}
            type="submit"
          >
            {stageLabel[stage]} {!busy && "→"}
          </button>
        </section>
      </form>
    </section>
  );
}
