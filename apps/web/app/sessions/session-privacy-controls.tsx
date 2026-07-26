"use client";

import { useState } from "react";

interface Props {
  readonly sessionId: string;
}

export function SessionPrivacyControls({ sessionId }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [deleting, setDeleting] = useState(false);

  const deleteSession = async () => {
    const token = window.sessionStorage.getItem(`swaram:${sessionId}:token`);
    if (!token) {
      setStatus("സ്വകാര്യ സെഷൻ ടോക്കൺ ലഭ്യമല്ല.");
      return;
    }
    setDeleting(true);
    setStatus("സെഷൻ ഇല്ലാതാക്കുന്നു…");
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}`,
        {
          method: "DELETE",
          headers: { "X-Session-Token": token },
        },
      );
      if (!response.ok) throw new Error("delete failed");
      window.sessionStorage.removeItem(`swaram:${sessionId}:token`);
      window.location.assign("/");
    } catch {
      setStatus("സെഷൻ ഇല്ലാതാക്കാനായില്ല. വീണ്ടും ശ്രമിക്കുക.");
      setDeleting(false);
    }
  };

  return (
    <aside
      aria-labelledby="privacy-controls-title"
      className="mt-8 rounded-xl border border-slate-700 bg-slate-950 p-4"
    >
      <h2 className="text-xl font-semibold" id="privacy-controls-title">
        സ്വകാര്യതയും ഡാറ്റ നിയന്ത്രണവും
      </h2>
      <p className="mt-2 text-slate-200">
        അപ്‌ലോഡ് ചെയ്ത ഓഡിയോ, വരികൾ, വിശകലനം, സ്കോറുകൾ എന്നിവ സ്വകാര്യമാണ്. സെഷൻ
        സൃഷ്ടിച്ചതിന് 24 മണിക്കൂറിന് ശേഷം അവ സ്വയം നീക്കം ചെയ്യും. മൈക്രോഫോൺ
        ഓഡിയോ ബ്രൗസറിന് പുറത്തേക്ക് അയയ്ക്കുകയോ സൂക്ഷിക്കുകയോ ഇല്ല.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">
          ഈ സെഷൻ ഇപ്പോൾ ഇല്ലാതാക്കുക
        </summary>
        <p className="mt-2 text-sm text-amber-100">
          ഇത് ഓഡിയോ, വരികൾ, വിശകലനം, റിപ്പോർട്ടുകൾ എന്നിവ ശാശ്വതമായി നീക്കും.
        </p>
        <label className="mt-3 flex items-start gap-2">
          <input
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          ഈ സെഷന്റെ എല്ലാ ഡാറ്റയും ഇല്ലാതാക്കണമെന്ന് ഞാൻ സ്ഥിരീകരിക്കുന്നു.
        </label>
        <button
          className="mt-3 border border-red-400 text-red-100"
          disabled={!confirmed || deleting}
          onClick={() => void deleteSession()}
          type="button"
        >
          {deleting ? "ഇല്ലാതാക്കുന്നു…" : "സെഷൻ ശാശ്വതമായി ഇല്ലാതാക്കുക"}
        </button>
      </details>
      <p aria-live="assertive" className="mt-2 text-red-200">
        {status}
      </p>
    </aside>
  );
}
