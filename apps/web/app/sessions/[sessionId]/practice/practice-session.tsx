"use client";

import {
  comparePitchToReferenceWindow,
  type LivePitchFrame,
  type PhraseComparisonSample,
} from "@swaram/audio-core";
import {
  AnalysisPackageV1Schema,
  type AnalysisPackageV1,
} from "@swaram/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  AudioSessionController,
  type AudioSessionState,
} from "../../../../lib/audio-session";
import { HeadphoneCalibration } from "./headphone-calibration";
import {
  playbackModeAvailability,
  preferredPlaybackMode,
  type PlaybackMode,
  type PlaybackModeAvailability,
} from "./playback-modes";
import { PitchCanvas } from "./pitch-canvas";
import type { ContourPoint } from "./pitch-renderer";
import {
  activeLyricIndex,
  PracticeLyrics,
  type PracticeLyricLine,
} from "./practice-lyrics";
import { buildAttemptPayload } from "./build-attempt";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [controller, setController] = useState<AudioSessionController | null>(
    null,
  );
  const [sessionState, setSessionState] =
    useState<AudioSessionState>(INITIAL_STATE);
  const [ready, setReady] = useState(false);
  const [songTimeMs, setSongTimeMs] = useState(0);
  const [pitch, setPitch] = useState<LivePitchFrame | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisPackageV1 | null>(null);
  const [lyrics, setLyrics] = useState<readonly PracticeLyricLine[]>([]);
  const [modes, setModes] = useState<readonly PlaybackModeAvailability[]>([]);
  const [activeMode, setActiveMode] = useState<PlaybackMode | null>(null);
  const [playbackSources, setPlaybackSources] = useState<
    Partial<Record<PlaybackMode, string>>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loopStartMs, setLoopStartMs] = useState<number | null>(null);
  const [loopEndMs, setLoopEndMs] = useState<number | null>(null);
  const [countIn, setCountIn] = useState(false);
  const [countInActive, setCountInActive] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<0.5 | 0.75 | 0.9 | 1>(1);
  const [loopStatus, setLoopStatus] = useState("ലൂപ്പ് ഓഫാണ്.");
  const lastPitchRender = useRef(0);
  const lastTimeRender = useRef(0);
  const livePoints = useRef<ContourPoint[]>([]);
  const attemptSamples = useRef<PhraseComparisonSample[]>([]);
  const referencePoints = useMemo(
    () =>
      analysis?.pitch_frames.map((frame) => ({
        timeMs: frame.time_ms,
        midi: frame.midi,
        voiced: frame.voiced,
      })) ?? [],
    [analysis],
  );
  const referenceObservations = useMemo(
    () =>
      analysis?.pitch_frames.map((frame) => ({
        timeMs: frame.time_ms,
        frequencyHz: frame.frequency_hz,
        confidence: frame.confidence,
        voiced: frame.voiced,
      })) ?? [],
    [analysis],
  );
  const referenceMidiByTime = useMemo(
    () =>
      new Map(
        analysis?.pitch_frames
          .filter((frame) => frame.midi !== null)
          .map((frame) => [frame.time_ms, frame.midi!]) ?? [],
      ),
    [analysis],
  );
  const getLivePoints = useCallback(() => livePoints.current, []);
  const getReferencePoints = useCallback(
    () => referencePoints,
    [referencePoints],
  );
  const getCurrentTimeMs = useCallback(
    () => controller?.getPracticeTime().comparisonTimeMs ?? 0,
    [controller],
  );

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
        const availability = playbackModeAvailability(assets);
        const preferred = preferredPlaybackMode(availability);
        if (!preferred) throw new Error("playback unavailable");
        const availableModes = availability.filter(
          (mode): mode is PlaybackModeAvailability & { assetId: string } =>
            mode.available && mode.assetId !== null,
        );
        const [analysisResponse, lyricsResponse, modeResponses] =
          await Promise.all([
            fetch(`${apiUrl}/api/v1/sessions/${sessionId}/analysis`, {
              headers: { "X-Session-Token": token },
            }),
            fetch(`${apiUrl}/api/v1/sessions/${sessionId}/lyrics`, {
              headers: { "X-Session-Token": token },
            }),
            Promise.all(
              availableModes.map(async (mode) => {
                const response = await fetch(
                  `${apiUrl}/api/v1/sessions/${sessionId}/assets/${mode.assetId}/playback-url`,
                  { headers: { "X-Session-Token": token } },
                );
                if (!response.ok) throw new Error("playback unavailable");
                const payload = (await response.json()) as { url: string };
                return [mode.mode, payload.url] as const;
              }),
            ),
          ]);
        if (!analysisResponse.ok) throw new Error("analysis unavailable");
        if (!lyricsResponse.ok) throw new Error("lyrics unavailable");
        const parsedAnalysis = AnalysisPackageV1Schema.parse(
          await analysisResponse.json(),
        );
        const lyricPayload = (await lyricsResponse.json()) as {
          lines: PracticeLyricLine[];
        };
        if (!active) {
          return;
        }
        const sources = Object.fromEntries(modeResponses) as Partial<
          Record<PlaybackMode, string>
        >;
        const initialSource = sources[preferred];
        if (!initialSource) throw new Error("playback unavailable");
        audioController = new AudioSessionController({
          playbackUrl: initialSource,
        });
        setAnalysis(parsedAnalysis);
        setLyrics(lyricPayload.lines);
        setModes(availability);
        setPlaybackSources(sources);
        setActiveMode(preferred);
        setController(audioController);
      })
      .catch(() => {
        if (active) setLoadError("സ്വകാര്യ പരിശീലന ഓഡിയോ ലോഡ് ചെയ്യാനായില്ല.");
      });
    return () => {
      active = false;
      if (audioController) void audioController.dispose();
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
      if (
        controller.getState().status === "playing" &&
        frame.voiced &&
        frame.midi !== null
      ) {
        const correctedTime = controller.getPracticeTime();
        const timeMs = correctedTime.comparisonTimeMs;
        livePoints.current.push({
          timeMs,
          midi: frame.midi,
          voiced: true,
        });
        if (livePoints.current.length > 3_000) {
          livePoints.current.splice(0, livePoints.current.length - 3_000);
        }
        const comparison = comparePitchToReferenceWindow(
          referenceObservations,
          {
            frequencyHz: frame.frequencyHz,
            confidence: frame.confidence,
            voiced: frame.voiced,
          },
          correctedTime,
        );
        const referenceMidi = comparison.valid
          ? referenceMidiByTime.get(comparison.referenceTimeMs)
          : undefined;
        if (comparison.valid && referenceMidi !== undefined) {
          attemptSamples.current.push({
            timeMs,
            referenceMidi,
            userMidi: frame.midi,
            signedCents: comparison.signedCents,
            timeOffsetMs: comparison.timeOffsetMs,
            confidence: comparison.confidence,
          });
        }
      }
      if (performance.now() - lastPitchRender.current >= 100) {
        lastPitchRender.current = performance.now();
        setPitch(frame);
      }
    });
    const unsubscribeLoop = controller.onLoopBoundary((_region, action) => {
      livePoints.current.length = 0;
      attemptSamples.current.length = 0;
      setCountInActive(action === "begin_count_in");
      setLoopStatus(
        action === "begin_count_in"
          ? "കൗണ്ട്-ഇൻ നടക്കുന്നു…"
          : "ലൂപ്പ് വീണ്ടും ആരംഭിച്ചു.",
      );
    });
    return () => {
      unsubscribeState();
      unsubscribePitch();
      unsubscribeLoop();
    };
  }, [controller, referenceMidiByTime, referenceObservations]);

  useEffect(() => {
    if (!controller || !analysis || !activeMode) return;
    return controller.onCompleted(() => {
      setCountInActive(false);
      const payload = buildAttemptPayload(
        analysis,
        lyrics,
        attemptSamples.current,
        {
          mode: activeMode,
          speed: playbackSpeed,
          latencyOffsetMs: controller.getState().latencyOffsetMs,
          profile: "intermediate",
        },
      );
      const token = window.sessionStorage.getItem(`swaram:${sessionId}:token`);
      if (!token) {
        setCompleted(true);
        return;
      }
      void fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/sessions/${sessionId}/attempts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Token": token,
          },
          body: JSON.stringify(payload),
        },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("attempt save failed");
          return (await response.json()) as { id: string };
        })
        .then(({ id }) => router.push(`/sessions/${sessionId}/reports/${id}`))
        .catch(() => setCompleted(true));
    });
  }, [
    activeMode,
    analysis,
    controller,
    lyrics,
    playbackSpeed,
    router,
    sessionId,
  ]);

  useEffect(() => {
    if (!controller || !ready) return;
    let animationFrame = 0;
    const update = () => {
      try {
        controller.processLoop(performance.now());
        if (performance.now() - lastTimeRender.current >= 250) {
          lastTimeRender.current = performance.now();
          setSongTimeMs(controller.getPracticeTime().comparisonTimeMs);
        }
      } catch {
        return;
      }
      animationFrame = requestAnimationFrame(update);
    };
    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [controller, ready]);

  useEffect(() => {
    if (!controller || !ready) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (controller.getState().status === "playing") controller.pause();
        else if (controller.getState().canPlay) void controller.play();
      } else if (
        event.key.toLowerCase() === "r" &&
        ["playing", "paused"].includes(controller.getState().status)
      ) {
        void controller.restart();
      } else if (event.key === "Escape") {
        void controller.stop();
      } else if (event.key === "[") {
        setLoopStartMs(controller.getPracticeTime().comparisonTimeMs);
      } else if (event.key === "]") {
        setLoopEndMs(controller.getPracticeTime().comparisonTimeMs);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, ready]);

  const applyLoop = (startMs: number, endMs: number) => {
    if (!controller) return;
    try {
      controller.setLoop(startMs, endMs, countIn ? 2_000 : 0);
      setLoopStartMs(startMs);
      setLoopEndMs(endMs);
      setLoopStatus(
        `ലൂപ്പ്: ${(startMs / 1_000).toFixed(1)}–${(endMs / 1_000).toFixed(1)} സെക്കൻഡ്`,
      );
    } catch {
      setLoopStatus("ലൂപ്പ് പോയിന്റുകൾക്കിടയിൽ കുറഞ്ഞത് 0.25 സെക്കൻഡ് വേണം.");
    }
  };

  if (loadError) return <main className="p-6 text-red-200">{loadError}</main>;
  if (!controller)
    return <main className="p-6">പരിശീലനം ലോഡ് ചെയ്യുന്നു…</main>;

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      {completed ? (
        <section aria-label="പരിശീലനം പൂർത്തിയായി">
          <h1 className="text-3xl font-semibold">പരിശീലനം പൂർത്തിയായി</h1>
          <p className="mt-3">ഈ പരിശീലന റൗണ്ട് അവസാനിച്ചു.</p>
          <button
            className="mt-5"
            onClick={() => {
              setCompleted(false);
              setReady(false);
            }}
            type="button"
          >
            വീണ്ടും പരിശീലിക്കുക
          </button>
        </section>
      ) : !ready ? (
        <HeadphoneCalibration
          controller={controller}
          onReady={() => {
            controller.estimateLatency();
            const requestedSeek = Number(searchParams.get("seek"));
            if (Number.isFinite(requestedSeek) && requestedSeek >= 0) {
              controller.seek(requestedSeek);
              setSongTimeMs(requestedSeek);
            }
            setReady(true);
          }}
        />
      ) : (
        <section aria-label="പരിശീലന നിയന്ത്രണങ്ങൾ">
          <h1 className="text-3xl font-semibold">സ്വരം പരിശീലനം</h1>
          <p aria-live="polite" className="mt-2 font-semibold">
            അവസ്ഥ:{" "}
            {countInActive
              ? "കൗണ്ട്-ഇൻ"
              : sessionState.status === "playing"
                ? "പരിശീലിക്കുന്നു"
                : sessionState.status === "paused"
                  ? "ഇടവേള"
                  : "തയ്യാർ"}
          </p>
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
          <fieldset className="mt-4">
            <legend className="font-semibold">പ്ലേബാക്ക് മോഡ്</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {modes.map((mode) => (
                <button
                  aria-pressed={activeMode === mode.mode}
                  disabled={!mode.available}
                  key={mode.mode}
                  onClick={() => {
                    const source = playbackSources[mode.mode];
                    if (!source) return;
                    void controller
                      .switchPlaybackSource(source)
                      .then(() => setActiveMode(mode.mode));
                  }}
                  title={mode.reason ?? undefined}
                  type="button"
                >
                  {mode.mode === "original"
                    ? "ഒറിജിനൽ"
                    : mode.mode === "instrumental"
                      ? "ഇൻസ്ട്രുമെന്റൽ"
                      : "കുറഞ്ഞ വോക്കൽ"}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="mt-4 block">
            അനുഗമന ശബ്ദനില
            <input
              className="ml-3"
              defaultValue="100"
              max="100"
              min="0"
              onChange={(event) =>
                controller.setAccompanimentVolume(
                  Number(event.target.value) / 100,
                )
              }
              type="range"
            />
          </label>
          <label className="mt-3 block text-slate-400">
            റഫറൻസ് വോക്കൽ ശബ്ദനില
            <input
              className="ml-3"
              disabled
              max="100"
              min="0"
              title="സുരക്ഷിതമായ കുറഞ്ഞ-വോക്കൽ മിക്സ് ലഭ്യമല്ല."
              type="range"
              value="0"
            />
          </label>
          {analysis && (
            <div className="mt-5">
              <PitchCanvas
                getCurrentTimeMs={getCurrentTimeMs}
                getLive={getLivePoints}
                getReference={getReferencePoints}
                onSelectRegion={applyLoop}
                showNoteLanes
                toleranceCents={50}
              />
            </div>
          )}
          <PracticeLyrics
            currentTimeMs={songTimeMs}
            isPlaying={sessionState.status === "playing"}
            lines={lyrics}
            onSeek={(timeMs) => {
              controller.seek(timeMs);
              setSongTimeMs(timeMs);
            }}
          />
          <section aria-label="ലൂപ്പ്, വേഗ നിയന്ത്രണങ്ങൾ" className="mt-5">
            <p aria-live="polite">{loopStatus}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setLoopStartMs(songTimeMs)} type="button">
                ഇൻ പോയിന്റ്
              </button>
              <button onClick={() => setLoopEndMs(songTimeMs)} type="button">
                ഔട്ട് പോയിന്റ്
              </button>
              <button
                disabled={loopStartMs === null || loopEndMs === null}
                onClick={() => {
                  if (loopStartMs !== null && loopEndMs !== null) {
                    applyLoop(loopStartMs, loopEndMs);
                  }
                }}
                type="button"
              >
                മാനുവൽ ലൂപ്പ്
              </button>
              <button
                onClick={() => {
                  const index = activeLyricIndex(lyrics, songTimeMs);
                  const line = lyrics[index];
                  if (line && line.start_ms !== null && line.end_ms !== null) {
                    applyLoop(line.start_ms, line.end_ms);
                  }
                }}
                type="button"
              >
                ഇപ്പോഴത്തെ വരി ലൂപ്പ്
              </button>
              <button
                onClick={() => {
                  controller.clearLoop();
                  setLoopStartMs(null);
                  setLoopEndMs(null);
                  setLoopStatus("ലൂപ്പ് ഓഫാണ്.");
                }}
                type="button"
              >
                ലൂപ്പ് നീക്കുക
              </button>
            </div>
            <label className="mt-3 block">
              <input
                checked={countIn}
                onChange={(event) => setCountIn(event.target.checked)}
                type="checkbox"
              />{" "}
              വീണ്ടും തുടങ്ങുന്നതിന് മുമ്പ് 2 സെക്കൻഡ് കൗണ്ട്-ഇൻ
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {([0.5, 0.75, 0.9, 1] as const).map((speed) => (
                <button
                  key={speed}
                  onClick={() => {
                    controller.setPlaybackRate(speed);
                    setPlaybackSpeed(speed);
                  }}
                  type="button"
                >
                  {speed}×
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-slate-300">
              ഗ്രാഫിൽ തിരശ്ചീനമായി വലിച്ചും ലൂപ്പ് തിരഞ്ഞെടുക്കാം. ബ്രൗസർ
              പിന്തുണയ്ക്കുന്നിടത്ത് വേഗം മാറ്റുമ്പോൾ ശ്രുതി സംരക്ഷിക്കും.
            </p>
          </section>
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
          <p className="mt-4 text-sm text-slate-300">
            കീബോർഡ്: Space പ്ലേ/ഇടവേള, R വീണ്ടും തുടങ്ങുക, [ ഇൻ, ] ഔട്ട്, Escape
            നിർത്തുക.
          </p>
        </section>
      )}
    </main>
  );
}
