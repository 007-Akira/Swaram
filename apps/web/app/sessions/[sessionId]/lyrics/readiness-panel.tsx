"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface ReadinessIssue {
  code: string;
  message: string;
  action: string;
}

interface Props {
  sessionId: string;
  token: string | null;
  refreshKey: number;
}

export function ReadinessPanel({ sessionId, token, refreshKey }: Props) {
  const [ready, setReady] = useState(false);
  const [issues, setIssues] = useState<ReadinessIssue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    void fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}/readiness`,
      { headers: { "X-Session-Token": token } },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("readiness unavailable");
        return (await response.json()) as {
          ready: boolean;
          issues: ReadinessIssue[];
        };
      })
      .then((payload) => {
        setReady(payload.ready);
        setIssues(Array.isArray(payload.issues) ? payload.issues : []);
      })
      .catch(() => {
        setReady(false);
        setIssues([
          {
            code: "readiness_unavailable",
            message: "Readiness could not be checked.",
            action: "Check the API connection and try again.",
          },
        ]);
      })
      .finally(() => setLoading(false));
  }, [refreshKey, sessionId, token]);

  return (
    <section
      aria-label="Practice readiness"
      className="mb-6 rounded-xl border border-amber-800 bg-amber-950/20 p-4"
    >
      <h2 className="text-xl font-semibold">Ready to practice?</h2>
      {!token ? (
        <ul className="mt-3 space-y-2">
          <li className="rounded-lg bg-black/20 p-3">
            <p>Private session access is unavailable.</p>
            <p className="text-sm text-amber-200">
              Return to the session creation screen.
            </p>
          </li>
        </ul>
      ) : loading ? (
        <p>Checking your session…</p>
      ) : ready ? (
        <p className="mt-2 text-emerald-300">Everything is ready.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {issues.map((issue) => (
            <li className="rounded-lg bg-black/20 p-3" key={issue.code}>
              <p>{issue.message}</p>
              <p className="text-sm text-amber-200">{issue.action}</p>
            </li>
          ))}
        </ul>
      )}
      {token && ready && !loading ? (
        <Link
          className="mt-4 inline-block rounded-lg bg-emerald-400 px-5 py-3 font-semibold text-[#07130f]"
          href={`/sessions/${sessionId}/practice`}
        >
          Start practice
        </Link>
      ) : (
        <button
          className="mt-4 rounded-lg bg-emerald-400 px-5 py-3 font-semibold text-[#07130f] disabled:cursor-not-allowed disabled:opacity-40"
          disabled
          type="button"
        >
          Start practice
        </button>
      )}
    </section>
  );
}
