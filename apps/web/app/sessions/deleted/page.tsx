import Link from "next/link";

import { SessionStatusLayout } from "../../components/session-status-layout";

export default function DeletedSessionPage() {
  return (
    <SessionStatusLayout badge="Deletion complete">
      <section className="py-20 text-center" tabIndex={-1}>
        <div
          aria-hidden="true"
          className="mx-auto grid size-16 place-items-center rounded-full bg-[#fed488] text-3xl text-[#5d4201]"
        >
          ✓
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold sm:text-4xl">
          Your private session has been deleted
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-7 text-[#5a403c]">
          Its uploaded audio and generated session files are no longer available
          through Swaram.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded bg-[#8b0000] px-5 py-2 font-semibold text-white"
            href="/#start"
          >
            Start another session
          </Link>
          <Link
            className="inline-flex min-h-11 items-center px-5 py-2 font-semibold text-[#610000] underline"
            href="/"
          >
            Return home
          </Link>
        </div>
      </section>
    </SessionStatusLayout>
  );
}
