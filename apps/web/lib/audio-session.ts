import {
  assessPlaybackLeakage,
  estimateLatencyOffsetMs,
  generateCalibrationChirp,
  LivePitchProcessor,
  nudgeLatencyOffsetMs,
  PracticeClock,
  type CorrectedSongTime,
  type LeakageCalibrationResult,
  type LivePitchFrame,
} from "@swaram/audio-core";

export type AudioSessionStatus =
  | "idle"
  | "requesting_permission"
  | "calibrating"
  | "ready"
  | "playing"
  | "paused"
  | "stopped"
  | "error";

export interface AudioSessionState {
  readonly status: AudioSessionStatus;
  readonly canCalibrate: boolean;
  readonly canPlay: boolean;
  readonly canPause: boolean;
  readonly microphoneActive: boolean;
  readonly latencyOffsetMs: number;
  readonly error: string | null;
}

interface TrackLike {
  stop(): void;
}

interface StreamLike {
  getTracks(): TrackLike[];
}

interface PortLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

interface AudioNodeLike {
  connect(node: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

interface WorkletNodeLike extends AudioNodeLike {
  readonly port: PortLike;
}

interface AudioBufferLike {
  copyToChannel(source: Float32Array, channelNumber: number): void;
}

interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  onended: ((event: Event) => void) | null;
  start(): void;
}

interface AudioContextLike {
  readonly sampleRate: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  readonly destination: AudioNodeLike;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createMediaElementSource(element: PlaybackElementLike): AudioNodeLike;
  createMediaStreamSource(stream: StreamLike): AudioNodeLike;
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
  close(): Promise<void>;
}

interface PlaybackElementLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly readyState: number;
  loop: boolean;
  playbackRate: number;
  volume: number;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  remove(): void;
}

export interface AudioSessionEnvironment {
  readonly isSecureContext: boolean;
  readonly getUserMedia: (
    constraints: MediaStreamConstraints,
  ) => Promise<StreamLike>;
  readonly createAudioContext: () => AudioContextLike;
  readonly createWorkletNode: (context: AudioContextLike) => WorkletNodeLike;
  readonly createPlaybackElement: () => PlaybackElementLike;
  readonly addVisibilityListener: (listener: () => void) => void;
  readonly removeVisibilityListener: (listener: () => void) => void;
  readonly isDocumentHidden: () => boolean;
}

export interface AudioSessionOptions {
  readonly playbackUrl: string;
  readonly workletUrl?: string;
  readonly pitchDebug?: boolean;
}

type StateListener = (state: AudioSessionState) => void;
type FrameListener = (
  frame: Float32Array,
  sampleRate: number,
  audioTimeMs: number,
) => void;
type PitchListener = (frame: LivePitchFrame) => void;

const LEGAL_TRANSITIONS: Readonly<
  Record<AudioSessionStatus, ReadonlySet<AudioSessionStatus>>
> = {
  idle: new Set(["requesting_permission", "stopped", "error"]),
  requesting_permission: new Set(["calibrating", "stopped", "error"]),
  calibrating: new Set(["ready", "stopped", "error"]),
  ready: new Set(["playing", "stopped", "error"]),
  playing: new Set(["paused", "stopped", "error"]),
  paused: new Set(["playing", "stopped", "error"]),
  stopped: new Set(["requesting_permission", "error"]),
  error: new Set(["requesting_permission", "stopped"]),
};

function deriveState(
  status: AudioSessionStatus,
  error: string | null = null,
  latencyOffsetMs = 0,
): AudioSessionState {
  return {
    status,
    canCalibrate: status === "calibrating",
    canPlay: status === "ready" || status === "paused",
    canPause: status === "playing",
    microphoneActive: ["calibrating", "ready", "playing", "paused"].includes(
      status,
    ),
    latencyOffsetMs,
    error,
  };
}

function defaultEnvironment(): AudioSessionEnvironment | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null;
  }
  const AudioContextConstructor = window.AudioContext;
  if (
    !navigator.mediaDevices?.getUserMedia ||
    !AudioContextConstructor ||
    typeof AudioWorkletNode === "undefined"
  ) {
    return null;
  }
  return {
    isSecureContext: window.isSecureContext,
    getUserMedia: (constraints) =>
      navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: () => new AudioContextConstructor(),
    createWorkletNode: (context) =>
      new AudioWorkletNode(context as AudioContext, "pitch-frame-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      }),
    createPlaybackElement: () => new Audio(),
    addVisibilityListener: (listener) =>
      document.addEventListener("visibilitychange", listener),
    removeVisibilityListener: (listener) =>
      document.removeEventListener("visibilitychange", listener),
    isDocumentHidden: () => document.hidden,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "മൈക്രോഫോൺ അനുമതി ലഭിച്ചില്ല. ബ്രൗസർ ക്രമീകരണത്തിൽ അനുമതി നൽകുക.";
  }
  return "ഓഡിയോ സെഷൻ ആരംഭിക്കാനായില്ല. വീണ്ടും ശ്രമിക്കുക.";
}

export class AudioSessionController {
  private state = deriveState("idle");
  private readonly stateListeners = new Set<StateListener>();
  private readonly frameListeners = new Set<FrameListener>();
  private readonly pitchListeners = new Set<PitchListener>();
  private readonly pitchProcessor: LivePitchProcessor;
  private readonly visibilityListener = () => {
    if (this.environment?.isDocumentHidden()) {
      void this.stop();
    }
  };
  private context: AudioContextLike | null = null;
  private stream: StreamLike | null = null;
  private microphoneSource: AudioNodeLike | null = null;
  private playbackSource: AudioNodeLike | null = null;
  private worklet: WorkletNodeLike | null = null;
  private playback: PlaybackElementLike | null = null;
  private practiceClock: PracticeClock | null = null;
  private disposed = false;
  private lifecycleGeneration = 0;
  private latencyOffsetMs = 0;

  constructor(
    private readonly options: AudioSessionOptions,
    private readonly environment: AudioSessionEnvironment | null = defaultEnvironment(),
  ) {
    this.pitchProcessor = new LivePitchProcessor({
      debug: options.pitchDebug ?? false,
    });
    this.environment?.addVisibilityListener(this.visibilityListener);
  }

  getState(): AudioSessionState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onPitchFrame(listener: PitchListener): () => void {
    this.pitchListeners.add(listener);
    return () => this.pitchListeners.delete(listener);
  }

  async requestPermission(): Promise<void> {
    this.assertUsable();
    if (
      this.state.status !== "idle" &&
      this.state.status !== "stopped" &&
      this.state.status !== "error"
    ) {
      return;
    }
    if (!this.environment || !this.environment.isSecureContext) {
      this.transition(
        "error",
        "മൈക്രോഫോൺ ഉപയോഗിക്കാൻ HTTPS പിന്തുണ ആവശ്യമാണ്.",
      );
      return;
    }
    this.transition("requesting_permission");
    const generation = ++this.lifecycleGeneration;
    try {
      await this.releaseResources();
      const stream = await this.environment.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      if (generation !== this.lifecycleGeneration) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      this.context = this.environment.createAudioContext();
      await this.context.audioWorklet.addModule(
        this.options.workletUrl ?? "/audio/pitch-frame-worklet.js",
      );
      if (generation !== this.lifecycleGeneration) {
        await this.releaseResources();
        return;
      }
      this.playback = this.environment.createPlaybackElement();
      this.playback.src = this.options.playbackUrl;
      this.practiceClock = new PracticeClock(
        this.playback,
        this.latencyOffsetMs,
      );
      this.microphoneSource = this.context.createMediaStreamSource(this.stream);
      this.playbackSource = this.context.createMediaElementSource(
        this.playback,
      );
      this.worklet = this.environment.createWorkletNode(this.context);
      this.worklet.port.onmessage = (event) => {
        if (
          typeof event.data !== "object" ||
          event.data === null ||
          !("samples" in event.data) ||
          !("audioTimeMs" in event.data) ||
          !(event.data.samples instanceof ArrayBuffer) ||
          typeof event.data.audioTimeMs !== "number"
        ) {
          return;
        }
        const frame = new Float32Array(event.data.samples);
        const audioTimeMs = event.data.audioTimeMs;
        const sampleRate = this.context?.sampleRate ?? 0;
        for (const listener of this.frameListeners) {
          listener(frame, sampleRate, audioTimeMs);
        }
        if (sampleRate > 0) {
          const pitchFrame = this.pitchProcessor.process(
            frame,
            sampleRate,
            audioTimeMs,
          );
          for (const listener of this.pitchListeners) listener(pitchFrame);
        }
      };
      this.microphoneSource.connect(this.worklet);
      this.playbackSource.connect(this.context.destination);
      this.transition("calibrating");
    } catch (error) {
      await this.releaseResources();
      if (generation === this.lifecycleGeneration) {
        this.transition("error", errorMessage(error));
      }
    }
  }

  completeCalibration(): void {
    this.transition("ready");
  }

  estimateLatency(detectedRoundTripMs?: number): number {
    if (!this.context) throw new Error("Audio context is unavailable");
    this.latencyOffsetMs = estimateLatencyOffsetMs({
      baseLatencySeconds: this.context.baseLatency,
      outputLatencySeconds: this.context.outputLatency,
      detectedRoundTripMs,
    });
    this.practiceClock?.setLatencyOffsetMs(this.latencyOffsetMs);
    this.publishCurrentState();
    return this.latencyOffsetMs;
  }

  nudgeLatency(nudgeMs: number): number {
    this.latencyOffsetMs = nudgeLatencyOffsetMs(this.latencyOffsetMs, nudgeMs);
    this.practiceClock?.setLatencyOffsetMs(this.latencyOffsetMs);
    this.publishCurrentState();
    return this.latencyOffsetMs;
  }

  getPracticeTime(): CorrectedSongTime {
    if (!this.practiceClock) throw new Error("Practice clock is unavailable");
    return this.practiceClock.current();
  }

  async switchPlaybackSource(
    playbackUrl: string,
    preserveAlignedTime = true,
  ): Promise<void> {
    if (!this.playback) throw new Error("Playback is unavailable");
    const wasPlaying = this.state.status === "playing";
    const currentTime = preserveAlignedTime ? this.playback.currentTime : 0;
    this.playback.pause();
    this.playback.src = playbackUrl;
    this.playback.load();
    if (this.playback.readyState === 0) {
      await new Promise<void>((resolve) => {
        this.playback?.addEventListener("loadedmetadata", () => resolve(), {
          once: true,
        });
      });
    }
    this.playback.currentTime = Math.min(
      currentTime,
      Number.isFinite(this.playback.duration)
        ? this.playback.duration
        : currentTime,
    );
    if (wasPlaying) await this.playback.play();
  }

  setAccompanimentVolume(volume: number): void {
    if (!this.playback) throw new Error("Playback is unavailable");
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new Error("Volume must be between 0 and 1");
    }
    this.playback.volume = volume;
  }

  async calibrateLeakage(
    allowTestingOverride = false,
  ): Promise<LeakageCalibrationResult> {
    if (this.state.status !== "calibrating" || !this.context) {
      throw new Error(`Cannot calibrate audio from ${this.state.status}`);
    }
    const reference = generateCalibrationChirp(this.context.sampleRate);
    const capturedFrames: Float32Array[] = [];
    const unsubscribe = this.onFrame((frame) =>
      capturedFrames.push(frame.slice()),
    );
    const buffer = this.context.createBuffer(
      1,
      reference.length,
      this.context.sampleRate,
    );
    buffer.copyToChannel(reference, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      source.start();
    });
    unsubscribe();
    source.disconnect();
    const capturedLength = capturedFrames.reduce(
      (total, frame) => total + frame.length,
      0,
    );
    const captured = new Float32Array(capturedLength);
    let offset = 0;
    for (const frame of capturedFrames) {
      captured.set(frame, offset);
      offset += frame.length;
    }
    const result = assessPlaybackLeakage(
      reference,
      captured,
      this.context.sampleRate,
      allowTestingOverride,
    );
    this.pitchProcessor.reset();
    if (result.canContinue) this.completeCalibration();
    return result;
  }

  async play(): Promise<void> {
    if (this.state.status !== "ready" && this.state.status !== "paused") {
      throw new Error(`Cannot play audio from ${this.state.status}`);
    }
    if (!this.playback) throw new Error("Playback is unavailable");
    try {
      await this.playback.play();
      this.transition("playing");
    } catch (error) {
      this.transition("error", errorMessage(error));
    }
  }

  pause(): void {
    if (this.state.status !== "playing") {
      throw new Error(`Cannot pause audio from ${this.state.status}`);
    }
    this.playback?.pause();
    this.transition("paused");
  }

  async restart(): Promise<void> {
    if (this.state.status !== "playing" && this.state.status !== "paused") {
      throw new Error(`Cannot restart audio from ${this.state.status}`);
    }
    if (!this.playback) throw new Error("Playback is unavailable");
    this.playback.currentTime = 0;
    if (this.state.status === "paused") {
      await this.play();
    }
  }

  async stop(): Promise<void> {
    if (this.state.status === "stopped") return;
    this.lifecycleGeneration += 1;
    await this.releaseResources();
    this.transition("stopped");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.environment?.removeVisibilityListener(this.visibilityListener);
    await this.stop();
    this.stateListeners.clear();
    this.frameListeners.clear();
    this.pitchListeners.clear();
    this.disposed = true;
  }

  private transition(
    status: AudioSessionStatus,
    error: string | null = null,
  ): void {
    if (status === this.state.status) return;
    if (!LEGAL_TRANSITIONS[this.state.status].has(status)) {
      throw new Error(
        `Illegal audio session transition: ${this.state.status} -> ${status}`,
      );
    }
    this.state = deriveState(status, error, this.latencyOffsetMs);
    this.publishCurrentState();
  }

  private publishCurrentState(): void {
    this.state = { ...this.state, latencyOffsetMs: this.latencyOffsetMs };
    for (const listener of this.stateListeners) listener(this.state);
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("Audio session has been disposed");
  }

  private async releaseResources(): Promise<void> {
    this.playback?.pause();
    if (this.playback) {
      this.playback.src = "";
      this.playback.load();
      this.playback.remove();
    }
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
    }
    this.microphoneSource?.disconnect();
    this.playbackSource?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.context) await this.context.close();
    this.worklet = null;
    this.microphoneSource = null;
    this.playbackSource = null;
    this.stream = null;
    this.context = null;
    this.playback = null;
    this.practiceClock = null;
  }
}
