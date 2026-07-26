export interface YinOptions {
  readonly minFrequencyHz?: number;
  readonly maxFrequencyHz?: number;
  readonly threshold?: number;
  readonly silenceRmsThreshold?: number;
}

export interface YinPitchResult {
  readonly frequencyHz: number | null;
  readonly confidence: number;
  readonly voiced: boolean;
}

const DEFAULT_MIN_FREQUENCY_HZ = 80;
const DEFAULT_MAX_FREQUENCY_HZ = 1_000;
const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_SILENCE_RMS_THRESHOLD = 0.01;

const UNVOICED: YinPitchResult = {
  frequencyHz: null,
  confidence: 0,
  voiced: false,
};

function validateOptions(
  frame: Float32Array,
  sampleRate: number,
  options: YinOptions,
): Required<YinOptions> {
  const values = {
    minFrequencyHz: options.minFrequencyHz ?? DEFAULT_MIN_FREQUENCY_HZ,
    maxFrequencyHz: options.maxFrequencyHz ?? DEFAULT_MAX_FREQUENCY_HZ,
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
    silenceRmsThreshold:
      options.silenceRmsThreshold ?? DEFAULT_SILENCE_RMS_THRESHOLD,
  };
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("sampleRate must be a positive finite number");
  }
  if (frame.length < 4) {
    throw new RangeError("frame must contain at least four samples");
  }
  if (
    values.minFrequencyHz <= 0 ||
    values.maxFrequencyHz <= values.minFrequencyHz ||
    values.maxFrequencyHz >= sampleRate / 2
  ) {
    throw new RangeError(
      "frequency range must be positive, ordered, and below Nyquist",
    );
  }
  if (values.threshold <= 0 || values.threshold >= 1) {
    throw new RangeError("threshold must be between 0 and 1");
  }
  if (values.silenceRmsThreshold < 0) {
    throw new RangeError("silenceRmsThreshold must not be negative");
  }
  return values;
}

function rootMeanSquare(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / frame.length);
}

function parabolicTau(cmnd: Float64Array, tau: number): number {
  if (tau <= 0 || tau >= cmnd.length - 1) {
    return tau;
  }
  const previous = cmnd[tau - 1];
  const current = cmnd[tau];
  const next = cmnd[tau + 1];
  if (previous === undefined || current === undefined || next === undefined) {
    return tau;
  }
  const denominator = 2 * (2 * current - next - previous);
  if (Math.abs(denominator) < Number.EPSILON) {
    return tau;
  }
  const adjustment = (next - previous) / denominator;
  return Math.abs(adjustment) <= 1 ? tau + adjustment : tau;
}

export function detectPitchYin(
  frame: Float32Array,
  sampleRate: number,
  options: YinOptions = {},
): YinPitchResult {
  const config = validateOptions(frame, sampleRate, options);
  if (rootMeanSquare(frame) < config.silenceRmsThreshold) {
    return UNVOICED;
  }

  const minTau = Math.max(2, Math.floor(sampleRate / config.maxFrequencyHz));
  const maxTau = Math.min(
    Math.ceil(sampleRate / config.minFrequencyHz),
    frame.length - 2,
  );
  if (maxTau <= minTau) {
    throw new RangeError(
      "frame is too short for the configured minimum frequency",
    );
  }

  const difference = new Float64Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    const sampleCount = frame.length - tau;
    for (let index = 0; index < sampleCount; index += 1) {
      const current = frame[index];
      const delayed = frame[index + tau];
      if (current === undefined || delayed === undefined) {
        continue;
      }
      const delta = current - delayed;
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const cmnd = new Float64Array(maxTau + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau] ?? 0;
    cmnd[tau] =
      runningSum === 0 ? 1 : ((difference[tau] ?? 0) * tau) / runningSum;
  }

  let selectedTau: number | null = null;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if ((cmnd[tau] ?? 1) >= config.threshold) {
      continue;
    }
    while (tau + 1 <= maxTau && (cmnd[tau + 1] ?? 1) < (cmnd[tau] ?? 1)) {
      tau += 1;
    }
    selectedTau = tau;
    break;
  }
  if (selectedTau === null) {
    return UNVOICED;
  }

  const refinedTau = parabolicTau(cmnd, selectedTau);
  const frequencyHz = sampleRate / refinedTau;
  const confidence = Math.max(0, Math.min(1, 1 - (cmnd[selectedTau] ?? 1)));
  if (
    !Number.isFinite(frequencyHz) ||
    frequencyHz < config.minFrequencyHz ||
    frequencyHz > config.maxFrequencyHz
  ) {
    return UNVOICED;
  }
  return { frequencyHz, confidence, voiced: true };
}
