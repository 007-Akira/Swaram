"use client";

import type { LeakageCalibrationResult } from "@swaram/audio-core";
import { useState } from "react";

interface CalibrationController {
  getState(): { readonly status: string; readonly error?: string | null };
  requestPermission(): Promise<void>;
  calibrateLeakage(
    allowTestingOverride?: boolean,
  ): Promise<LeakageCalibrationResult>;
}

interface Props {
  readonly controller: CalibrationController;
  readonly onReady: () => void;
}

const RESULT_TEXT: Record<LeakageCalibrationResult["level"], string> = {
  low: "Playback leakage is low. You can continue to practice.",
  moderate: "Some playback is leaking. Lower the headphone volume.",
  high: "Too much playback is reaching the microphone. Use headphones and try again.",
  inconclusive: "The microphone signal is too low. Check the connection.",
};

export function HeadphoneCalibration({ controller, onReady }: Props) {
  const [permissionReady, setPermissionReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<LeakageCalibrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestPermission = async () => {
    setRunning(true);
    setError(null);
    try {
      await controller.requestPermission();
      const state = controller.getState();
      if (state.status !== "calibrating") {
        setError(state.error ?? "The microphone could not start.");
        throw new Error("microphone unavailable");
      }
      setPermissionReady(true);
    } catch {
      setError((current) => current ?? "The microphone could not start.");
    } finally {
      setRunning(false);
    }
  };

  const calibrate = async () => {
    setRunning(true);
    setError(null);
    try {
      const nextResult = await controller.calibrateLeakage(override);
      setResult(nextResult);
      if (nextResult.canContinue) onReady();
    } catch {
      setError("The leakage check could not be completed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section aria-label="Headphone check">
      <h1>Headphone check</h1>
      <p>
        Headphones are required for accurate pitch comparison. Stay quiet while
        the test sound is playing.
      </p>
      <p>
        The browser cannot confirm that you are wearing headphones. This check
        only measures playback leaking into the microphone.
      </p>
      {!permissionReady ? (
        <button
          disabled={running}
          onClick={() => void requestPermission()}
          type="button"
        >
          Allow microphone
        </button>
      ) : (
        <button
          disabled={running}
          onClick={() => void calibrate()}
          type="button"
        >
          Check leakage
        </button>
      )}
      {result && (
        <div aria-live="polite">
          <p>{RESULT_TEXT[result.level]}</p>
          <p>Correlation: {result.peakCorrelation.toFixed(2)}</p>
        </div>
      )}
      {result?.level === "high" && !result.canContinue && (
        <label>
          <input
            checked={override}
            onChange={(event) => setOverride(event.target.checked)}
            type="checkbox"
          />
          Override warning for testing only
        </label>
      )}
      {error && <p aria-live="assertive">{error}</p>}
    </section>
  );
}
