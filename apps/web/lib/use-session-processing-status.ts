"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  sessionMetadata,
  unavailableVariant,
  type SessionUnavailableVariant,
} from "./session-access";

export type ProcessingJobState =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ProcessingStatus {
  state: ProcessingJobState;
  progress: number;
  progress_stage: string;
  failure_code: string | null;
  attempt_count: number;
}

export function useSessionProcessingStatus(sessionId: string) {
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [unavailable, setUnavailable] =
    useState<SessionUnavailableVariant | null>(null);
  const [pollError, setPollError] = useState(false);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => {
    setPollError(false);
    setUnavailable(null);
    setRevision((value) => value + 1);
  }, []);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    const metadata = sessionMetadata(sessionId);
    if (!metadata.token) {
      queueMicrotask(() => setUnavailable(unavailableVariant(sessionId)));
      return;
    }
    if (!metadata.jobId) {
      queueMicrotask(() => setUnavailable("files_unavailable"));
      return;
    }

    const controller = new AbortController();
    let timer: number | null = null;
    let failures = 0;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

    const poll = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/api/v1/jobs/${metadata.jobId}`,
          {
            headers: { "X-Session-Token": metadata.token! },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          if ([401, 403, 404, 410].includes(response.status)) {
            setUnavailable(unavailableVariant(sessionId, response));
            return;
          }
          throw new Error("status unavailable");
        }
        const next = (await response.json()) as ProcessingStatus;
        if (stopped.current) return;
        failures = 0;
        setPollError(false);
        setStatus(next);
        if (["succeeded", "failed", "cancelled"].includes(next.state)) return;
        timer = window.setTimeout(() => void poll(), 2_000);
      } catch {
        if (controller.signal.aborted || stopped.current) return;
        failures += 1;
        setPollError(true);
        timer = window.setTimeout(
          () => void poll(),
          Math.min(2_000 * 2 ** Math.min(failures, 3), 15_000),
        );
      }
    };
    void poll();
    return () => {
      stopped.current = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [revision, sessionId]);

  return { status, unavailable, pollError, retry };
}
