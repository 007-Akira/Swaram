import { detectPitchYin, type YinPitchResult } from "./yin";

export interface LivePitchConfig {
  readonly minFrequencyHz: number;
  readonly maxFrequencyHz: number;
  readonly minimumRms: number;
  readonly minimumConfidence: number;
  readonly medianWindowSize: number;
  readonly octaveToleranceCents: number;
  readonly debug: boolean;
}

export interface LivePitchDebug {
  readonly rawFrequencyHz: number | null;
  readonly smoothedFrequencyHz: number | null;
  readonly rms: number;
}

export interface LivePitchFrame {
  readonly timeMs: number;
  readonly frequencyHz: number | null;
  readonly midi: number | null;
  readonly confidence: number;
  readonly voiced: boolean;
  readonly debug?: LivePitchDebug;
}

const DEFAULT_CONFIG: LivePitchConfig = {
  minFrequencyHz: 80,
  maxFrequencyHz: 1_000,
  minimumRms: 0.008,
  minimumConfidence: 0.75,
  medianWindowSize: 3,
  octaveToleranceCents: 80,
  debug: false,
};

function rms(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return samples.length > 0 ? Math.sqrt(energy / samples.length) : 0;
}

function midi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function centsBetween(first: number, second: number): number {
  return Math.abs(1_200 * Math.log2(first / second));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export class LivePitchProcessor {
  private readonly config: LivePitchConfig;
  private history: number[] = [];
  private pendingOctave: number | null = null;

  constructor(config: Partial<LivePitchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (
      this.config.minFrequencyHz <= 0 ||
      this.config.maxFrequencyHz <= this.config.minFrequencyHz ||
      this.config.minimumRms < 0 ||
      this.config.minimumConfidence < 0 ||
      this.config.minimumConfidence > 1 ||
      this.config.medianWindowSize < 1 ||
      this.config.medianWindowSize % 2 === 0
    ) {
      throw new Error("Invalid live pitch configuration");
    }
  }

  process(
    samples: Float32Array,
    sampleRate: number,
    audioTimeMs: number,
  ): LivePitchFrame {
    const frameRms = rms(samples);
    const raw =
      frameRms >= this.config.minimumRms
        ? detectPitchYin(samples, sampleRate, {
            minFrequencyHz: this.config.minFrequencyHz,
            maxFrequencyHz: this.config.maxFrequencyHz,
            silenceRmsThreshold: this.config.minimumRms,
          })
        : { frequencyHz: null, confidence: 0, voiced: false };
    return this.processObservation(raw, frameRms, audioTimeMs);
  }

  processObservation(
    raw: YinPitchResult,
    frameRms: number,
    audioTimeMs: number,
  ): LivePitchFrame {
    const rawFrequency = raw.frequencyHz;
    if (
      !raw.voiced ||
      rawFrequency === null ||
      rawFrequency < this.config.minFrequencyHz ||
      rawFrequency > this.config.maxFrequencyHz ||
      raw.confidence < this.config.minimumConfidence ||
      frameRms < this.config.minimumRms
    ) {
      this.history = [];
      this.pendingOctave = null;
      return this.frame(audioTimeMs, null, 0, frameRms, rawFrequency);
    }

    let accepted = rawFrequency;
    const center = this.history.length > 0 ? median(this.history) : null;
    if (center !== null) {
      const octaveDistance = Math.min(
        centsBetween(rawFrequency, center * 2),
        centsBetween(rawFrequency, center / 2),
      );
      if (octaveDistance <= this.config.octaveToleranceCents) {
        if (
          this.pendingOctave === null ||
          centsBetween(rawFrequency, this.pendingOctave) >
            this.config.octaveToleranceCents
        ) {
          this.pendingOctave = rawFrequency;
          accepted = center;
        } else {
          this.pendingOctave = null;
          this.history = [];
        }
      } else {
        this.pendingOctave = null;
      }
    }
    this.history.push(accepted);
    if (this.history.length > this.config.medianWindowSize)
      this.history.shift();
    const smoothed = median(this.history);
    return this.frame(
      audioTimeMs,
      smoothed,
      raw.confidence,
      frameRms,
      rawFrequency,
    );
  }

  reset(): void {
    this.history = [];
    this.pendingOctave = null;
  }

  private frame(
    timeMs: number,
    frequencyHz: number | null,
    confidence: number,
    frameRms: number,
    rawFrequencyHz: number | null,
  ): LivePitchFrame {
    return {
      timeMs,
      frequencyHz,
      midi: frequencyHz === null ? null : midi(frequencyHz),
      confidence,
      voiced: frequencyHz !== null,
      ...(this.config.debug
        ? {
            debug: {
              rawFrequencyHz,
              smoothedFrequencyHz: frequencyHz,
              rms: frameRms,
            },
          }
        : {}),
    };
  }
}
