"use client";

import type { LivePitchFrame } from "@swaram/audio-core";
import { useEffect, useRef, useState } from "react";

import {
  AudioSessionController,
  type AudioSessionState,
} from "../../../../lib/audio-session";
import { HeadphoneCalibration } from "./headphone-calibration";

interface Props {
  readonly sessionId: string;
}

const INITIAL_STATE: AudioSessionState = {
  status: "idle",
  canCalibrate: false,
  canPlay: false,
  canPause: false,
  microphoneActive: false,
  latencyOffsetMs: 0,
  error: null,
};

export function PracticeSession({ sessionId }: Props) {
  const [controller, setController] = useState<AudioSessionController | null>(
    null,
  );
  const [sessionState, setSessionState] =
    useState<AudioSessionState>(INITIAL_STATE);
  const [ready, setReady] = useState(false);
  const [songTimeMs, setSongTimeMs] = useState(0);
  const [pitch, setPitch] = useState<LivePitchFrame | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastPitchRender = useRef(0);

  useEffect(() => {
    let active = true;
    const token = window.sessionStorage.getItem(`swaram:${sessionId}:token`);
    if (!token) {
      queueMicrotask(() => {
        if (active) {
          setLoadError("ഈ സ്വകാര്യ സെഷന്റെ ആക്‌സസ് ടോക്കൺ ലഭ്യമല്ല.");
        }
      });
      return () => {
        active = false;
      };
    }
    let objectUrl: string | null = null;
    let audioController: AudioSessionController | null = null;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    void fetch(`${apiUrl}/api/v1/sessions/${sessionId}`, {
      headers: { "X-Session-Token": token },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("session unavailable");
        return (await response.json()) as {
          assets: Array<{ id: string; kind: string }>;
        };
      })
      .then(async ({ assets }) => {
        const asset =
          assets.find(({ kind }) => kind === "instrumental") ??
          assets.find(({ kind }) => kind === "original_audio");
        if (!asset) throw new Error("playback unavailable");
        const response = await fetch(
          `${apiUrl}/api/v1/sessions/${sessionId}/assets/${asset.id}/playback`,
          { headers: { "X-Session-Token": token } },
        );
        if (!response.ok) throw new Error("playback unavailable");
        objectUrl = URL.createObjectURL(await response.blob());
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        audioController = new AudioSessionController({
          playbackUrl: objectUrl,
        });
        setController(audioController);
      })
      .catch(() => {
        if (active) setLoadError("സ്വകാര്യ പരിശീലന ഓഡിയോ ലോഡ് ചെയ്യാനായില്ല.");
      });
    return () => {
      active = false;
      if (audioController) void audioController.dispose();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!controller) return;
    const unsubscribeState = controller.subscribe((state) => {
      setSessionState(state);
      if (state.status === "stopped" || state.status === "error") {
        setReady(false);
      }
    });
    const unsubscribePitch = controller.onPitchFrame((frame) => {
      if (performance.now() - lastPitchRender.current >= 100) {
        lastPitchRender.current = performance.now();
        setPitch(frame);
      }
    });
    return () => {
      unsubscribeState();
      unsubscribePitch();
    };
  }, [controller]);

  useEffect(() => {
    if (!controller || !ready) return;
    let animationFrame = 0;
    const update = () => {
      try {
        setSongTimeMs(controller.getPracticeTime().comparisonTimeMs);
      } catch {
        return;
      }
      animationFrame = requestAnimationFrame(update);
    };
    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [controller, ready]);

  if (loadError) return <main className="p-6 text-red-200">{loadError}</main>;
  if (!controller)
    return <main className="p-6">പരിശീലനം ലോഡ് ചെയ്യുന്നു…</main>;

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      {!ready ? (
        <HeadphoneCalibration
          controller={controller}
          onReady={() => {
            controller.estimateLatency();
            setReady(true);
          }}
        />
      ) : (
        <section aria-label="പരിശീലന നിയന്ത്രണങ്ങൾ">
          <h1 className="text-3xl font-semibold">സ്വരം പരിശീലനം</h1>
          <p className="mt-3">
            സമയം: {(songTimeMs / 1_000).toFixed(1)} സെക്കൻഡ്
          </p>
          <p className="mt-2">
            ഇപ്പോഴത്തെ ശ്രുതി:{" "}
            {pitch?.frequencyHz ? `${pitch.frequencyHz.toFixed(1)} Hz` : "—"}
          </p>
          <p className="mt-2">
            ലേറ്റൻസി തിരുത്തൽ: {sessionState.latencyOffsetMs} ms
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              disabled={!sessionState.canPlay}
              onClick={() => void controller.play()}
              type="button"
            >
              പ്ലേ
            </button>
            <button
              disabled={!sessionState.canPause}
              onClick={() => controller.pause()}
              type="button"
            >
              ഇടവേള
            </button>
            <button onClick={() => controller.nudgeLatency(-10)} type="button">
              ലേറ്റൻസി −10 ms
            </button>
            <button onClick={() => controller.nudgeLatency(10)} type="button">
              ലേറ്റൻസി +10 ms
            </button>
            <button onClick={() => void controller.stop()} type="button">
              നിർത്തുക
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
