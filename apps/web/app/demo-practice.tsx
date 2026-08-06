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
    <aside className="rounded-lg border border-[#e3beb8] bg-[#fff0ee] p-4 text-[#261816]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#775a19]">
            Ready-made local demo
          </p>
          <p className="mt-1 text-sm text-[#5a403c]">
            Skip setup and practise with the stored test song.
          </p>
        </div>
        <button
          className="shrink-0 rounded bg-[#8b0000] px-5 py-3 font-semibold text-white hover:bg-[#610000]"
          onClick={openDemo}
          type="button"
        >
          Practice demo song →
        </button>
      </div>
    </aside>
  );
}
