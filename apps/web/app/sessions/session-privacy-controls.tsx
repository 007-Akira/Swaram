"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { markSessionDeleted, sessionToken } from "../../lib/session-access";

interface Props {
  readonly sessionId: string;
}

export function SessionPrivacyControls({ sessionId }: Props) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [deleting, setDeleting] = useState(false);

  const deleteSession = async () => {
    const token = sessionToken(sessionId);
    if (!token) {
      setStatus("The private session token is unavailable.");
      return;
    }
    setDeleting(true);
    setStatus("Deleting session…");
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}`,
        {
          method: "DELETE",
          headers: { "X-Session-Token": token },
        },
      );
      if (!response.ok) throw new Error("delete failed");
      window.dispatchEvent(
        new CustomEvent("swaram:session-deleted", { detail: { sessionId } }),
      );
      markSessionDeleted(sessionId);
      router.replace("/sessions/deleted");
    } catch {
      setStatus("The session could not be deleted. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <aside
      aria-labelledby="privacy-controls-title"
      className="mt-8 rounded-xl border border-slate-700 bg-slate-950 p-4"
    >
      <h2 className="text-xl font-semibold" id="privacy-controls-title">
        Privacy and data controls
      </h2>
      <p className="mt-2 text-slate-200">
        Uploaded audio, lyrics, analysis, and scores are private. They are
        automatically removed 24 hours after the session is created. Microphone
        audio is never sent outside or stored beyond your browser.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">
          Delete this session now
        </summary>
        <p className="mt-2 text-sm text-amber-100">
          This permanently removes the audio, lyrics, analysis, and reports.
        </p>
        <label className="mt-3 flex items-start gap-2">
          <input
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          I confirm that I want to delete all data in this session.
        </label>
        <button
          className="mt-3 border border-red-400 text-red-100"
          disabled={!confirmed || deleting}
          onClick={() => void deleteSession()}
          type="button"
        >
          {deleting ? "Deleting…" : "Delete session permanently"}
        </button>
      </details>
      <p aria-live="assertive" className="mt-2 text-red-200">
        {status}
      </p>
    </aside>
  );
}
