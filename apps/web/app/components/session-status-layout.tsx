import Link from "next/link";
import type { ReactNode } from "react";

export function SessionStatusLayout({
  children,
  badge = "Private session",
}: {
  readonly children: ReactNode;
  readonly badge?: string;
}) {
  return (
    <main className="session-surface min-h-screen bg-[#fff8f6] px-4 py-8 text-[#261816] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between border-b border-[#e3beb8] pb-5">
          <Link
            className="font-display text-2xl font-semibold text-[#610000]"
            href="/"
          >
            Swaram
          </Link>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#e3beb8] bg-[#fff0ee] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#775a19]">
            <span aria-hidden="true">●</span>
            {badge}
          </span>
        </header>
        {children}
      </div>
    </main>
  );
}
