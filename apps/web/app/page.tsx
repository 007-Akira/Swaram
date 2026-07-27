import Link from "next/link";

import { StartSession } from "./start-session";
import { TestSessionRedirect } from "./test-session-redirect";

const workflow = [
  {
    number: "01",
    title: "Bring your song",
    description: "Add a supported audio file and paste or upload its lyrics.",
  },
  {
    number: "02",
    title: "Sync every line",
    description:
      "Tap along with the song, then fine-tune timing on the waveform.",
  },
  {
    number: "03",
    title: "Practice your pitch",
    description: "Sing with live visual feedback and review each attempt.",
  },
];

export default function Home() {
  const testSessionId =
    process.env.NODE_ENV === "development"
      ? process.env.SWARAM_TEST_SESSION_ID
      : undefined;
  const testSessionToken =
    process.env.NODE_ENV === "development"
      ? process.env.SWARAM_TEST_SESSION_TOKEN
      : undefined;
  if (testSessionId && testSessionToken) {
    return (
      <TestSessionRedirect sessionId={testSessionId} token={testSessionToken} />
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06100d] text-[#f3faf6]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 12%, rgba(52,211,153,.16), transparent 30%), radial-gradient(circle at 88% 8%, rgba(34,211,238,.12), transparent 26%)",
        }}
      />

      <nav className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <Link
          className="flex items-center gap-3"
          href="/"
          aria-label="Swaram home"
        >
          <span className="grid size-10 place-items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-lg text-emerald-200">
            S
          </span>
          <span>
            <span className="block text-lg font-semibold tracking-tight">
              Swaram
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.28em] text-emerald-200/60">
              Private pitch studio
            </span>
          </span>
        </Link>
        <div className="hidden items-center gap-2 text-xs text-slate-300 sm:flex">
          <span className="size-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.8)]" />
          Audio stays private
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-20 lg:pt-20">
        <div>
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
            Malayalam singing, made visible
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[.98] tracking-[-0.055em] sm:text-7xl">
            Find the note.
            <span className="mt-2 block bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 bg-clip-text text-transparent">
              Feel the song.
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
            A focused practice space that turns your voice into clear, real-time
            pitch feedback—built especially for Malayalam songs.
          </p>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
            {[
              ["24h", "Auto-delete"],
              ["Live", "Pitch view"],
              ["Local", "Mic audio"],
            ].map(([value, label]) => (
              <div
                className="rounded-2xl border border-white/[.07] bg-white/[.035] p-4"
                key={label}
              >
                <p className="text-xl font-semibold text-emerald-200">
                  {value}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-400">
                  {label}
                </p>
              </div>
            ))}
          </div>

          <div
            aria-hidden="true"
            className="mt-12 hidden h-20 items-center gap-1.5 lg:flex"
          >
            {[20, 35, 28, 48, 62, 42, 70, 84, 56, 68, 45, 30, 52, 76, 62].map(
              (height, index) => (
                <span
                  className="w-1 rounded-full bg-gradient-to-t from-emerald-500/20 to-cyan-200/70"
                  key={`${height}-${index}`}
                  style={{ height: `${height}%` }}
                />
              ),
            )}
            <span className="ml-3 text-sm text-slate-500">your voice</span>
          </div>
        </div>

        <StartSession />
      </section>

      <section className="relative border-t border-white/[.06] bg-black/10">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <div className="mb-10 max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              One simple flow
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              From song to confident take.
            </h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {workflow.map((step) => (
              <li
                className="group rounded-3xl border border-white/[.07] bg-[#0a1713] p-6 transition-colors hover:border-emerald-300/25"
                key={step.number}
              >
                <span className="font-mono text-xs text-emerald-300/70">
                  {step.number}
                </span>
                <h3 className="mt-8 text-xl font-semibold">{step.title}</h3>
                <p className="mt-3 leading-6 text-slate-400">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
