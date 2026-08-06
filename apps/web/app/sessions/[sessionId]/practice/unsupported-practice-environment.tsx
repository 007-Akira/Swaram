"use client";

import Link from "next/link";

import type { PracticeCapabilityIssue } from "../../../../lib/use-practice-capabilities";

const issueContent: Record<
  PracticeCapabilityIssue,
  { title: string; reason: string }
> = {
  insecure_context: {
    title: "A secure connection is required",
    reason:
      "Browsers only allow microphone practice on HTTPS or a local development address.",
  },
  microphone_api_unavailable: {
    title: "Microphone access is unavailable",
    reason: "Live pitch feedback needs the browser’s microphone API.",
  },
  microphone_permission_denied: {
    title: "Microphone permission was denied",
    reason: "Swaram needs permission to analyse pitch locally while you sing.",
  },
  no_input_device: {
    title: "No microphone was found",
    reason: "Connect or enable an input device before starting live practice.",
  },
  audio_worklet_unavailable: {
    title: "Real-time audio processing is unsupported",
    reason:
      "This browser does not provide AudioWorklet, which Swaram uses for live pitch analysis.",
  },
  audio_context_unavailable: {
    title: "Browser audio is unsupported",
    reason:
      "This environment does not provide the Web Audio API required for practice.",
  },
  audio_decoding_unavailable: {
    title: "Audio decoding is unsupported",
    reason:
      "The browser cannot decode the private practice audio using the required API.",
  },
  canvas_unavailable: {
    title: "Pitch visualisation is unsupported",
    reason: "This browser cannot render the live pitch canvas.",
  },
  unknown: {
    title: "Live practice could not start",
    reason:
      "An unexpected browser capability problem prevented practice from starting.",
  },
};

export function UnsupportedPracticeEnvironment({
  issues,
  onRetry,
  sessionId,
}: {
  readonly issues: readonly PracticeCapabilityIssue[];
  readonly onRetry: () => void;
  readonly sessionId: string;
}) {
  const items = issues.length ? issues : (["unknown"] as const);
  return (
    <section
      className="rounded-xl border border-amber-700 bg-amber-950/20 p-6"
      role="alert"
    >
      <p className="text-sm font-bold uppercase tracking-wider text-amber-300">
        Browser check
      </p>
      <h1 className="mt-2 text-3xl font-semibold">
        Practice is not supported yet
      </h1>
      <ul className="mt-5 space-y-3">
        {items.map((issue) => (
          <li className="rounded-lg bg-black/20 p-4" key={issue}>
            <p className="font-semibold">{issueContent[issue].title}</p>
            <p className="mt-1 text-sm text-slate-300">
              {issueContent[issue].reason}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-slate-300">
        Check the site’s microphone permission and your device input settings,
        then retry. A current version of Chrome, Edge, Firefox, or Safari is
        recommended.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button onClick={onRetry} type="button">
          Check again
        </button>
        <Link
          className="inline-flex min-h-11 items-center px-3 underline"
          href={`/sessions/${sessionId}/lyrics`}
        >
          Return to lyric editor
        </Link>
      </div>
    </section>
  );
}
