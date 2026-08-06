"use client";

import { useRouter } from "next/navigation";

interface Props {
  readonly sessionId: string;
  readonly token: string;
}

export function DemoPractice({ sessionId, token }: Props) {
  const router = useRouter();

  const openDemo = () => {
    window.sessionStorage.setItem(`swaram:${sessionId}:token`, token);
    window.sessionStorage.setItem(
      `swaram:${sessionId}:song-name`,
      "Swaram demo song",
    );
    router.push(`/sessions/${sessionId}/practice`);
  };

  return (
    <aside className="rounded-2xl border border-amber-200/20 bg-amber-200/[.07] p-4 text-amber-50">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
            Ready-made local demo
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Skip setup and practise with the stored test song.
          </p>
        </div>
        <button
          className="shrink-0 bg-amber-200 px-4 py-3 font-semibold text-[#261900] hover:bg-amber-100"
          onClick={openDemo}
          type="button"
        >
          Practice demo song →
        </button>
      </div>
    </aside>
  );
}
