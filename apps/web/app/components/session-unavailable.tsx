"use client";

import Link from "next/link";

import type { SessionUnavailableVariant } from "../../lib/session-access";
import { SessionStatusLayout } from "./session-status-layout";

const content: Record<
  SessionUnavailableVariant,
  { icon: string; title: string; description: string; retry: boolean }
> = {
  expired: {
    icon: "⌛",
    title: "This private session has expired",
    description:
      "Swaram automatically deletes uploaded audio and generated practice files after the session’s retention period.",
    retry: false,
  },
  deleted: {
    icon: "✓",
    title: "This session has been deleted",
    description:
      "The private audio, lyrics, and generated practice data are no longer available.",
    retry: false,
  },
  not_found: {
    icon: "?",
    title: "This private session is unavailable",
    description:
      "The session may have expired, been deleted, or the private link may no longer be valid.",
    retry: true,
  },
  missing_token: {
    icon: "⌁",
    title: "Private session access is missing",
    description:
      "Open the original private session in this browser or create a new practice session.",
    retry: false,
  },
  invalid_token: {
    icon: "⌁",
    title: "Private session access is invalid",
    description:
      "This browser no longer has valid access to the private session.",
    retry: false,
  },
  access_denied: {
    icon: "⊘",
    title: "Access to this session was denied",
    description: "Swaram could not verify access to this private session.",
    retry: false,
  },
  files_unavailable: {
    icon: "!",
    title: "Practice files are unavailable",
    description:
      "The session exists, but one or more private practice files could not be loaded.",
    retry: true,
  },
  unknown: {
    icon: "!",
    title: "The session could not be opened",
    description:
      "A temporary problem prevented Swaram from loading this session.",
    retry: true,
  },
};

export function SessionUnavailable({
  variant,
  onRetry,
}: {
  readonly variant: SessionUnavailableVariant;
  readonly onRetry?: () => void;
}) {
  const item = content[variant];
  return (
    <SessionStatusLayout badge="Private by design">
      <section className="mx-auto py-20 text-center" role="alert">
        <div
          aria-hidden="true"
          className="mx-auto grid size-16 place-items-center rounded-full bg-[#ffdad4] text-3xl text-[#610000]"
        >
          {item.icon}
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold sm:text-4xl">
          {item.title}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-7 text-[#5a403c]">
          {item.description}
        </p>
        {variant === "expired" && (
          <p className="mx-auto mt-3 max-w-xl text-sm text-[#785a1a]">
            Private sessions are retained for 24 hours by default.
          </p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {item.retry && onRetry && (
            <button
              className="border border-[#8e706b] bg-white text-[#261816]"
              onClick={onRetry}
              type="button"
            >
              Try again
            </button>
          )}
          <Link
            className="inline-flex min-h-11 items-center rounded bg-[#8b0000] px-5 py-2 font-semibold text-white"
            href="/#start"
          >
            Start a new session
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded px-5 py-2 font-semibold text-[#610000] underline"
            href="/"
          >
            Return home
          </Link>
        </div>
      </section>
    </SessionStatusLayout>
  );
}
