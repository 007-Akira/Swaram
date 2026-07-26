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
  low: "പ്ലേബാക്ക് ചോർച്ച കുറവാണ്. പരിശീലനം തുടരാം.",
  moderate: "കുറച്ച് പ്ലേബാക്ക് ചോർച്ചയുണ്ട്. ഹെഡ്ഫോൺ ശബ്ദം കുറയ്ക്കുക.",
  high: "മൈക്രോഫോണിൽ പ്ലേബാക്ക് കൂടുതലായി കേൾക്കുന്നു. ഹെഡ്ഫോൺ ഉപയോഗിച്ച് വീണ്ടും ശ്രമിക്കുക.",
  inconclusive: "മൈക്രോഫോൺ സിഗ്നൽ വളരെ കുറവാണ്. കണക്ഷൻ പരിശോധിക്കുക.",
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
        setError(state.error ?? "മൈക്രോഫോൺ ആരംഭിക്കാനായില്ല.");
        throw new Error("microphone unavailable");
      }
      setPermissionReady(true);
    } catch {
      setError((current) => current ?? "മൈക്രോഫോൺ ആരംഭിക്കാനായില്ല.");
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
      setError("ചോർച്ച പരിശോധന പൂർത്തിയാക്കാനായില്ല.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section aria-label="ഹെഡ്ഫോൺ പരിശോധന">
      <h1>ഹെഡ്ഫോൺ പരിശോധന</h1>
      <p>
        ശരിയായ ശ്രുതി താരതമ്യത്തിന് ഹെഡ്ഫോൺ ആവശ്യമാണ്. പരിശോധനാ ശബ്ദം
        കേൾക്കുമ്പോൾ നിശ്ശബ്ദരായിരിക്കുക.
      </p>
      <p>
        ബ്രൗസറിന് ഹെഡ്ഫോൺ ധരിച്ചിട്ടുണ്ടെന്ന് ഉറപ്പാക്കാൻ കഴിയില്ല.
        മൈക്രോഫോണിലേക്കുള്ള പ്ലേബാക്ക് ചോർച്ച മാത്രമാണ് ഈ പരിശോധന അളക്കുന്നത്.
      </p>
      {!permissionReady ? (
        <button
          disabled={running}
          onClick={() => void requestPermission()}
          type="button"
        >
          മൈക്രോഫോൺ അനുവദിക്കുക
        </button>
      ) : (
        <button
          disabled={running}
          onClick={() => void calibrate()}
          type="button"
        >
          ചോർച്ച പരിശോധിക്കുക
        </button>
      )}
      {result && (
        <div aria-live="polite">
          <p>{RESULT_TEXT[result.level]}</p>
          <p>സഹബന്ധം: {result.peakCorrelation.toFixed(2)}</p>
        </div>
      )}
      {result?.level === "high" && !result.canContinue && (
        <label>
          <input
            checked={override}
            onChange={(event) => setOverride(event.target.checked)}
            type="checkbox"
          />
          പരിശോധനയ്ക്കായി മാത്രം മുന്നറിയിപ്പ് മറികടക്കുക
        </label>
      )}
      {error && <p aria-live="assertive">{error}</p>}
    </section>
  );
}
