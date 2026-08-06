import Link from "next/link";

import { DemoPractice } from "./demo-practice";
import { StartSession } from "./start-session";

export default function Home() {
  const testSessionId =
    process.env.NODE_ENV === "development"
      ? process.env.SWARAM_TEST_SESSION_ID
      : undefined;
  const testSessionToken =
    process.env.NODE_ENV === "development"
      ? process.env.SWARAM_TEST_SESSION_TOKEN
      : undefined;
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-[#fff8f6] text-[#261816]">
      <header className="sticky top-0 z-50 border-b border-[#e3beb8] bg-[#fff8f6]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 md:px-12">
          <Link
            aria-label="Swaram home"
            className="flex items-center gap-3 text-[#610000]"
            href="/"
          >
            <span className="grid size-9 place-items-center rounded-full border border-[#8b0000] font-display text-lg font-semibold">
              S
            </span>
            <span className="font-display text-2xl font-semibold">Swaram</span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-6 md:flex"
          >
            <a className="font-medium text-[#610000]" href="#start">
              Practice
            </a>
            <a className="text-[#5a403c] hover:text-[#610000]" href="#privacy">
              Privacy
            </a>
          </nav>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#e3beb8] bg-[#fff0ee] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#775a19]">
            <span aria-hidden="true">●</span> Private by design
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-10 px-4 py-10 md:px-12 md:py-12">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[#775a19]">
            Private Malayalam pitch practice
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Create a private practice session
          </h1>
          <p className="mt-3 text-lg text-[#5a403c]">
            Upload your reference track and lyrics to begin acoustic analysis.
          </p>
        </div>

        {testSessionId && testSessionToken && (
          <DemoPractice sessionId={testSessionId} token={testSessionToken} />
        )}

        <StartSession />
      </main>

      <footer className="border-t border-[#e3beb8] bg-[#fff0ee] py-6">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-4 text-sm text-[#5a403c] md:flex-row md:px-12">
          <span className="font-display text-lg font-semibold text-[#610000]">
            Swaram
          </span>
          <div className="flex items-center gap-5">
            <a className="hover:text-[#610000] hover:underline" href="#privacy">
              Privacy
            </a>
            <a
              className="hover:text-[#610000] hover:underline"
              href="https://github.com/007-Akira/Swaram"
              rel="noreferrer"
              target="_blank"
            >
              Source code
            </a>
          </div>
          <span>© {currentYear} Swaram</span>
        </div>
      </footer>
    </div>
  );
}
