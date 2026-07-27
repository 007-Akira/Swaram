"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  readonly sessionId: string;
  readonly token: string;
}

export function TestSessionRedirect({ sessionId, token }: Props) {
  const router = useRouter();

  useEffect(() => {
    window.sessionStorage.setItem(`swaram:${sessionId}:token`, token);
    router.replace(`/sessions/${sessionId}/lyrics`);
  }, [router, sessionId, token]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#06100d] p-6 text-[#f3faf6]">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">
          Local test session
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Opening lyric editor…</h1>
      </div>
    </main>
  );
}
