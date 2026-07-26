export interface LeakageCalibrationConfig {
  readonly minimumRms: number;
  readonly highCorrelation: number;
  readonly moderateCorrelation: number;
}

export type LeakageLevel = "low" | "moderate" | "high" | "inconclusive";

export interface LeakageCalibrationResult {
  readonly level: LeakageLevel;
  readonly microphoneRms: number;
  readonly peakCorrelation: number;
  readonly lagSamples: number;
  readonly canContinue: boolean;
}

export const DEFAULT_LEAKAGE_CONFIG: LeakageCalibrationConfig = {
  minimumRms: 0.001,
  highCorrelation: 0.55,
  moderateCorrelation: 0.25,
};

export function generateCalibrationChirp(
  sampleRate: number,
  durationSeconds = 0.4,
): Float32Array {
  if (sampleRate <= 0 || durationSeconds <= 0) {
    throw new Error(
      "Calibration chirp requires a positive sample rate and duration",
    );
  }
  const length = Math.round(sampleRate * durationSeconds);
  const signal = new Float32Array(length);
  let phase = 0;
  for (let index = 0; index < length; index += 1) {
    const progress = index / Math.max(1, length - 1);
    const frequency = 500 + 1_500 * progress;
    phase += (2 * Math.PI * frequency) / sampleRate;
    const envelope = Math.sin(Math.PI * progress) ** 2;
    signal[index] = Math.sin(phase) * envelope * 0.25;
  }
  return signal;
}

export function measureRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / samples.length);
}

export function measurePeakCorrelation(
  reference: Float32Array,
  captured: Float32Array,
  maximumLagSamples: number,
): { correlation: number; lagSamples: number } {
  if (reference.length === 0 || captured.length === 0) {
    return { correlation: 0, lagSamples: 0 };
  }
  let peak = 0;
  let peakLag = 0;
  const maximumLag = Math.min(
    Math.max(0, maximumLagSamples),
    Math.max(0, captured.length - 1),
  );
  for (let lag = 0; lag <= maximumLag; lag += 1) {
    const count = Math.min(reference.length, captured.length - lag);
    if (count < 16) continue;
    let dot = 0;
    let referenceEnergy = 0;
    let capturedEnergy = 0;
    for (let index = 0; index < count; index += 1) {
      const expected = reference[index] ?? 0;
      const observed = captured[index + lag] ?? 0;
      dot += expected * observed;
      referenceEnergy += expected * expected;
      capturedEnergy += observed * observed;
    }
    const denominator = Math.sqrt(referenceEnergy * capturedEnergy);
    const correlation = denominator > 0 ? Math.abs(dot / denominator) : 0;
    if (correlation > peak) {
      peak = correlation;
      peakLag = lag;
    }
  }
  return { correlation: peak, lagSamples: peakLag };
}

export function assessPlaybackLeakage(
  reference: Float32Array,
  captured: Float32Array,
  sampleRate: number,
  allowTestingOverride = false,
  config: LeakageCalibrationConfig = DEFAULT_LEAKAGE_CONFIG,
): LeakageCalibrationResult {
  const microphoneRms = measureRms(captured);
  const decimation = Math.max(1, Math.floor(sampleRate / 4_000));
  const analysisReference = reference.filter(
    (_, index) => index % decimation === 0,
  );
  const analysisCaptured = captured.filter(
    (_, index) => index % decimation === 0,
  );
  const peak = measurePeakCorrelation(
    analysisReference,
    analysisCaptured,
    Math.round((sampleRate * 0.5) / decimation),
  );
  let level: LeakageLevel;
  if (microphoneRms < config.minimumRms) level = "inconclusive";
  else if (peak.correlation >= config.highCorrelation) level = "high";
  else if (peak.correlation >= config.moderateCorrelation) level = "moderate";
  else level = "low";
  return {
    level,
    microphoneRms,
    peakCorrelation: peak.correlation,
    lagSamples: peak.lagSamples * decimation,
    canContinue: level !== "high" || allowTestingOverride,
  };
}
