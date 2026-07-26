"use client";

import { useEffect, useState } from "react";

import { AttemptReport, type AttemptReportRecord } from "./attempt-report";

export function ReportLoader({
  sessionId,
  attemptId,
}: {
  readonly sessionId: string;
  readonly attemptId: string;
}) {
  const [attempt, setAttempt] = useState<AttemptReportRecord | null>(null);
  const [history, setHistory] = useState<AttemptReportRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = window.sessionStorage.getItem(`swaram:${sessionId}:token`);
    if (!token) {
      queueMicrotask(() =>
        setError("The private report token is unavailable."),
      );
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const headers = { "X-Session-Token": token };
    void Promise.all([
      fetch(`${apiUrl}/api/v1/sessions/${sessionId}/attempts/${attemptId}`, {
        headers,
      }),
      fetch(`${apiUrl}/api/v1/sessions/${sessionId}/attempts`, { headers }),
    ])
      .then(async ([detail, list]) => {
        if (!detail.ok || !list.ok) throw new Error("report unavailable");
        return Promise.all([detail.json(), list.json()]);
      })
      .then(([detail, list]) => {
        setAttempt(detail as AttemptReportRecord);
        setHistory((list as { attempts: AttemptReportRecord[] }).attempts);
      })
      .catch(() => setError("The report could not be loaded."));
  }, [attemptId, sessionId]);
  if (error) return <main className="p-6 text-red-200">{error}</main>;
  if (!attempt) return <main className="p-6">Loading report…</main>;
  return (
    <AttemptReport attempt={attempt} history={history} sessionId={sessionId} />
  );
}
