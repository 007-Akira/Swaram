import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rememberSession } from "./session-access";
import { useSessionProcessingStatus } from "./use-session-processing-status";

describe("useSessionProcessingStatus", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("requests status immediately and exposes a completed job", async () => {
    rememberSession("session-1", {
      token: "private-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      songName: "song.wav",
      jobId: "job-1",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          state: "succeeded",
          progress: 100,
          progress_stage: "complete",
          failure_code: null,
          attempt_count: 1,
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useSessionProcessingStatus("session-1"),
    );
    await waitFor(() => expect(result.current.status?.state).toBe("succeeded"));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("private-token");
  });

  it("aborts the in-flight status request on unmount", () => {
    rememberSession("session-1", {
      token: "secret",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      songName: "song.wav",
      jobId: "job-1",
    });
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise(() => undefined);
      }),
    );
    const { unmount } = renderHook(() =>
      useSessionProcessingStatus("session-1"),
    );
    act(() => unmount());
    expect(signal?.aborted).toBe(true);
  });
});
