"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SessionStatusLayout } from "../../../components/session-status-layout";
import { SessionUnavailable } from "../../../components/session-unavailable";
import {
  markSessionDeleted,
  sessionMetadata,
} from "../../../../lib/session-access";
import { useSessionProcessingStatus } from "../../../../lib/use-session-processing-status";
import {
  ProcessingStageList,
  processingStageLabel,
} from "./processing-stage-list";

export function SessionProcessing({
  sessionId,
}: {
  readonly sessionId: string;
}) {
  const router = useRouter();
  const { status, unavailable, pollError, retry } =
    useSessionProcessingStatus(sessionId);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const redirected = useRef(false);
  const metadata =
    typeof window === "undefined" ? null : sessionMetadata(sessionId);

  useEffect(() => {
    if (status?.state === "succeeded" && !redirected.current) {
      redirected.current = true;
      router.replace(`/sessions/${sessionId}/lyrics`);
    }
  }, [router, sessionId, status?.state]);

  if (unavailable)
    return <SessionUnavailable onRetry={retry} variant={unavailable} />;

  const deleteSession = async () => {
    if (!metadata?.token) return;
    setDeleting(true);
    setActionError("");
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}`,
        { method: "DELETE", headers: { "X-Session-Token": metadata.token } },
      );
      if (!response.ok) throw new Error("delete failed");
      markSessionDeleted(sessionId);
      router.replace("/sessions/deleted");
    } catch {
      setDeleting(false);
      setActionError(
        "The session could not be deleted. Check your connection and try again.",
      );
    }
  };

  const retryProcessing = async () => {
    if (status?.state !== "failed" || !metadata?.token || !metadata.jobId) {
      retry();
      return;
    }
    setActionError("");
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/jobs/${metadata.jobId}/retry`,
        { method: "POST", headers: { "X-Session-Token": metadata.token } },
      );
      if (!response.ok) throw new Error("retry failed");
      retry();
    } catch {
      setActionError(
        "Processing could not be restarted. Please try again shortly.",
      );
    }
  };

  return (
    <SessionStatusLayout>
      <section className="py-12" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-[#775a19]">
              {metadata?.songName || "Uploaded song"}
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">
              Preparing your practice session
            </h1>
          </div>
          <div className="font-data text-sm text-[#5a403c]">
            Expires{" "}
            {metadata?.expiresAt
              ? new Date(metadata.expiresAt).toLocaleString()
              : "within 24 hours"}
          </div>
        </div>

        {!status ? (
          <div className="mt-10">
            <div className="h-1.5 overflow-hidden rounded-full bg-[#f8dcd8]">
              <div className="processing-indeterminate h-full w-1/3 bg-[#8b0000]" />
            </div>
            <p className="mt-4">Checking processing status…</p>
          </div>
        ) : (
          <>
            <div className="mt-8 rounded-lg border border-[#e3beb8] bg-white p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#775a19]">
                    Current stage
                  </p>
                  <p className="mt-1 text-xl font-semibold">
                    {status.state === "failed"
                      ? "Processing stopped"
                      : processingStageLabel(status.progress_stage)}
                  </p>
                </div>
                <span className="font-data text-lg">{status.progress}%</span>
              </div>
              <progress
                className="mt-4 h-2 w-full"
                max="100"
                value={status.progress}
              >
                {status.progress}%
              </progress>
            </div>
            <ProcessingStageList status={status} />
          </>
        )}

        {pollError && (
          <p className="mt-4 rounded bg-[#ffdad6] p-3 text-[#93000a]">
            The connection was interrupted. Swaram is retrying with a slower
            polling interval.
          </p>
        )}
        {status?.state === "failed" && (
          <div
            className="mt-6 rounded-lg border border-[#ba1a1a] bg-[#ffdad6] p-4 text-[#93000a]"
            role="alert"
          >
            <p className="font-semibold">
              Audio processing could not be completed.
            </p>
            <p className="mt-1 text-sm">
              You can retry the status check, delete this session, or return
              home.
            </p>
          </div>
        )}
        <p className="mt-8 leading-7 text-[#5a403c]">
          Complex or noisy recordings can take longer to analyse. Processing
          runs in Swaram’s private backend worker, so you may keep this page
          open or return using this same browser session.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {(status?.state === "failed" || pollError) && (
            <button
              className="border border-[#8e706b] bg-white"
              onClick={() => void retryProcessing()}
              type="button"
            >
              Retry
            </button>
          )}
          <button
            className="border border-[#ba1a1a] bg-transparent text-[#93000a]"
            disabled={deleting}
            onClick={() => void deleteSession()}
            type="button"
          >
            {deleting ? "Deleting…" : "Cancel and delete"}
          </button>
          {status?.state === "failed" && (
            <Link
              className="inline-flex min-h-11 items-center px-4 underline"
              href="/"
            >
              Return home
            </Link>
          )}
        </div>
        {actionError && (
          <p className="mt-4 text-[#93000a]" role="alert">
            {actionError}
          </p>
        )}
      </section>
    </SessionStatusLayout>
  );
}
