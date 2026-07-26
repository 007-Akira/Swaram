"use client";

import type { AnalysisPackageV1 } from "@swaram/contracts";
import {
  comparePitchFrames,
  detectPitchYin,
  type ToleranceClassification,
} from "@swaram/audio-core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  MicrophoneCapture,
  type MicrophoneState,
} from "../../lib/microphone-capture";
import { loadPrototypeData, type TimedLyric } from "../../lib/prototype-data";

interface LivePoint {
  readonly timeMs: number;
  readonly midi: number;
}

interface CurrentPitch {
  readonly frequencyHz: number;
  readonly midi: number;
  readonly confidence: number;
  readonly referenceCents: number | null;
  readonly classification: ToleranceClassification | null;
}

const MIDI_MIN = 45;
const MIDI_MAX = 84;
const TOLERANCE_MIDI = 0.5;

function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function pitchLabel(pitch: CurrentPitch | null): {
  note: string;
  cents: string;
} {
  if (!pitch) {
    return { note: "—", cents: "ശ്രുതി കാത്തിരിക്കുന്നു" };
  }
  const rounded = Math.round(pitch.midi);
  const names = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B",
  ];
  const note = names[((rounded % 12) + 12) % 12] ?? "—";
  const octave = Math.floor(rounded / 12) - 1;
  const cents = Math.round(
    pitch.referenceCents ?? (pitch.midi - rounded) * 100,
  );
  return {
    note: `${note}${octave}`,
    cents:
      cents === 0
        ? "ശ്രുതി കൃത്യം"
        : cents > 0
          ? `${cents} സെന്റ് ഉയരം ♯`
          : `${Math.abs(cents)} സെന്റ് താഴ്‌ച ♭`,
  };
}

function drawTimeline(
  canvas: HTMLCanvasElement,
  analysis: AnalysisPackageV1,
  livePoints: readonly LivePoint[],
  currentTimeMs: number,
): void {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#071b16";
  context.fillRect(0, 0, width, height);
  const durationMs = analysis.duration_seconds * 1_000;
  const x = (timeMs: number) => (timeMs / durationMs) * width;
  const y = (midi: number) =>
    height - ((midi - MIDI_MIN) / (MIDI_MAX - MIDI_MIN)) * height;
  const voicedReference = analysis.pitch_frames.filter(
    (frame) => frame.voiced && frame.midi !== null,
  );

  context.beginPath();
  voicedReference.forEach((frame, index) => {
    const pointX = x(frame.time_ms);
    const pointY = y((frame.midi ?? 0) + TOLERANCE_MIDI);
    if (index === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  });
  [...voicedReference].reverse().forEach((frame) => {
    context.lineTo(x(frame.time_ms), y((frame.midi ?? 0) - TOLERANCE_MIDI));
  });
  context.closePath();
  context.fillStyle = "rgba(52, 211, 153, 0.12)";
  context.fill();

  const stroke = (
    points: readonly { timeMs: number; midi: number }[],
    color: string,
    lineWidth: number,
  ) => {
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(x(point.timeMs), y(point.midi));
      else context.lineTo(x(point.timeMs), y(point.midi));
    });
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  };
  stroke(
    voicedReference.map((frame) => ({
      timeMs: frame.time_ms,
      midi: frame.midi ?? 0,
    })),
    "#6ee7b7",
    2,
  );
  stroke(livePoints, "#fb923c", 2);
  context.beginPath();
  context.moveTo(x(currentTimeMs), 0);
  context.lineTo(x(currentTimeMs), height);
  context.strokeStyle = "#f8fafc";
  context.lineWidth = 1;
  context.stroke();
}

export function PrototypePractice() {
  const [analysis, setAnalysis] = useState<AnalysisPackageV1 | null>(null);
  const [lyrics, setLyrics] = useState<TimedLyric[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [microphoneState, setMicrophoneState] = useState<MicrophoneState>({
    status: "idle",
    permission: "unknown",
    error: null,
  });
  const [currentPitch, setCurrentPitch] = useState<CurrentPitch | null>(null);
  const [activeLyric, setActiveLyric] = useState(-1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analysisRef = useRef<AnalysisPackageV1 | null>(null);
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const livePointsRef = useRef<LivePoint[]>([]);
  const lastPitchUpdateRef = useRef(0);
  const activeLyricRef = useRef(-1);

  useEffect(() => {
    let active = true;
    loadPrototypeData()
      .then((data) => {
        if (!active) return;
        analysisRef.current = data.analysis;
        setAnalysis(data.analysis);
        setLyrics(data.lyrics);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const capture = new MicrophoneCapture();
    captureRef.current = capture;
    const unsubscribeState = capture.subscribe(setMicrophoneState);
    const unsubscribeFrames = capture.onFrame((frame, sampleRate) => {
      if (!audioRef.current || sampleRate <= 0) return;
      const result = detectPitchYin(frame, sampleRate);
      if (!result.voiced || result.frequencyHz === null) return;
      const midi = frequencyToMidi(result.frequencyHz);
      const timeMs = audioRef.current.currentTime * 1_000;
      livePointsRef.current.push({
        timeMs,
        midi,
      });
      if (performance.now() - lastPitchUpdateRef.current >= 150) {
        lastPitchUpdateRef.current = performance.now();
        const referenceFrames = analysisRef.current?.pitch_frames ?? [];
        const approximateIndex =
          analysisRef.current && referenceFrames.length > 1
            ? Math.round(
                (timeMs / (analysisRef.current.duration_seconds * 1_000)) *
                  (referenceFrames.length - 1),
              )
            : -1;
        const referenceFrame =
          approximateIndex >= 0 ? referenceFrames[approximateIndex] : undefined;
        const comparison = comparePitchFrames(
          referenceFrame
            ? {
                frequencyHz: referenceFrame.frequency_hz,
                confidence: referenceFrame.confidence,
                voiced: referenceFrame.voiced,
              }
            : null,
          {
            frequencyHz: result.frequencyHz,
            confidence: result.confidence,
            voiced: result.voiced,
          },
          0.1,
        );
        setCurrentPitch({
          frequencyHz: result.frequencyHz,
          midi,
          confidence: result.confidence,
          referenceCents: comparison.valid ? comparison.signedCents : null,
          classification: comparison.valid ? comparison.classification : null,
        });
      }
    });
    return () => {
      unsubscribeState();
      unsubscribeFrames();
      void capture.stop();
      captureRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!analysis) return;
    let animationFrame = 0;
    const draw = () => {
      const currentTimeMs = (audioRef.current?.currentTime ?? 0) * 1_000;
      if (canvasRef.current) {
        drawTimeline(
          canvasRef.current,
          analysis,
          livePointsRef.current,
          currentTimeMs,
        );
      }
      const lyricIndex = lyrics.findIndex(
        (line) => currentTimeMs >= line.startMs && currentTimeMs < line.endMs,
      );
      if (lyricIndex !== activeLyricRef.current) {
        activeLyricRef.current = lyricIndex;
        setActiveLyric(lyricIndex);
      }
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [analysis, lyrics]);

  const restart = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    livePointsRef.current = [];
    setCurrentPitch(null);
    void audioRef.current.play();
  }, []);

  const toggleMicrophone = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture) return;
    if (capture.getState().status === "running") {
      await capture.stop();
    } else {
      await capture.start();
    }
  }, []);

  if (loadState === "loading") {
    return <main className="p-8">പരിശീലന മാതൃക ലോഡ് ചെയ്യുന്നു…</main>;
  }
  if (loadState === "error" || !analysis) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-3xl font-bold">പരിശീലന മാതൃക ലഭ്യമല്ല</h1>
        <p className="mt-4 text-emerald-50/70">
          സ്വകാര്യ റഫറൻസ് മീഡിയ ക്രമീകരിച്ച ശേഷം ഡെവലപ്‌മെന്റ് സെർവർ വീണ്ടും
          ആരംഭിക്കുക.
        </p>
      </main>
    );
  }

  const label = pitchLabel(currentPitch);
  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <header>
        <p className="text-sm font-semibold text-emerald-300">
          ശ്രുതി പരിശീലന മാതൃക
        </p>
        <h1 className="mt-2 text-4xl font-bold">
          കേൾക്കൂ · പാടൂ · താരതമ്യം ചെയ്യൂ
        </h1>
        <p className="mt-3 text-amber-200">
          ഹെഡ്‌ഫോൺ നിർബന്ധമാണ്. സ്പീക്കർ ഉപയോഗിച്ചാൽ മൈക്രോഫോൺ റഫറൻസ് ശബ്ദം
          പിടിച്ചെടുക്കും.
        </p>
      </header>

      <audio
        ref={audioRef}
        preload="metadata"
        src="/api/prototype-media/audio"
      />
      <section className="mt-6 flex flex-wrap gap-3">
        <button
          className="rounded bg-emerald-500 px-4 py-2 text-slate-950"
          onClick={() => void audioRef.current?.play()}
        >
          ആരംഭിക്കുക
        </button>
        <button
          className="rounded border border-emerald-700 px-4 py-2"
          onClick={() => audioRef.current?.pause()}
        >
          താൽക്കാലികമായി നിർത്തുക
        </button>
        <button
          className="rounded border border-emerald-700 px-4 py-2"
          onClick={restart}
        >
          വീണ്ടും തുടങ്ങുക
        </button>
        <button
          className="rounded border border-orange-500 px-4 py-2"
          onClick={() => void toggleMicrophone()}
        >
          {microphoneState.status === "running"
            ? "മൈക്രോഫോൺ നിർത്തുക"
            : "മൈക്രോഫോൺ തുടങ്ങുക"}
        </button>
      </section>
      {microphoneState.error ? (
        <p className="mt-3 text-red-300">{microphoneState.error}</p>
      ) : null}

      <section className="mt-6 grid gap-4 md:grid-cols-[1fr_220px]">
        <canvas
          ref={canvasRef}
          className="h-[420px] w-full rounded-xl border border-emerald-900"
          aria-label="റഫറൻസും തത്സമയ ശ്രുതിയും കാണിക്കുന്ന ഗ്രാഫ്"
        />
        <aside className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-5">
          <p className="text-sm text-emerald-200">ഇപ്പോഴത്തെ ശ്രുതി</p>
          <p className="mt-2 text-4xl font-bold">{label.note}</p>
          <p className="mt-2 text-xl">
            {currentPitch
              ? `${currentPitch.frequencyHz.toFixed(1)} Hz`
              : "— Hz"}
          </p>
          <p className="mt-2 text-sm text-emerald-100/70">{label.cents}</p>
        </aside>
      </section>

      <section className="mt-6 rounded-xl bg-black/20 p-5" aria-label="വരികൾ">
        {lyrics.map((line, index) => (
          <p
            key={`${line.startMs}-${line.text}`}
            className={
              index === activeLyric
                ? "text-xl font-bold text-amber-300"
                : "text-lg text-emerald-50/55"
            }
          >
            {line.text}
          </p>
        ))}
      </section>

      {process.env.NODE_ENV === "development" ? (
        <details className="mt-6 text-xs text-emerald-100/60">
          <summary>ഡീബഗ് വിവരങ്ങൾ</summary>
          <pre className="mt-2 overflow-auto">
            {JSON.stringify(
              {
                analysisVersion: analysis.analysis_version,
                referenceFrames: analysis.pitch_frames.length,
                microphone: microphoneState,
              },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </main>
  );
}
