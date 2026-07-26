export type MicrophoneStatus =
  | "idle"
  | "requesting"
  | "running"
  | "stopped"
  | "error";

export type MicrophonePermission =
  | "unknown"
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export interface MicrophoneState {
  readonly status: MicrophoneStatus;
  readonly permission: MicrophonePermission;
  readonly error: string | null;
}

export interface MicrophoneOptions {
  readonly echoCancellation?: boolean;
  readonly noiseSuppression?: boolean;
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

interface NodeLike {
  connect(node: NodeLike): NodeLike;
  disconnect(): void;
}

interface WorkletNodeLike extends NodeLike {
  readonly port: PortLike;
}

interface AudioContextLike {
  readonly sampleRate: number;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: StreamLike): NodeLike;
  close(): Promise<void>;
}

export interface MicrophoneEnvironment {
  readonly isSecureContext: boolean;
  readonly getUserMedia: (
    constraints: MediaStreamConstraints,
  ) => Promise<StreamLike>;
  readonly queryPermission?: () => Promise<PermissionState>;
  readonly createAudioContext: () => AudioContextLike;
  readonly createWorkletNode: (context: AudioContextLike) => WorkletNodeLike;
}

type StateListener = (state: MicrophoneState) => void;
type FrameListener = (
  frame: Float32Array,
  sampleRate: number,
  audioTimeMs: number,
) => void;

const INITIAL_STATE: MicrophoneState = {
  status: "idle",
  permission: "unknown",
  error: null,
};

function defaultEnvironment(): MicrophoneEnvironment | null {
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
    queryPermission: navigator.permissions
      ? async () => {
          const status = await navigator.permissions.query({
            name: "microphone" as PermissionName,
          });
          return status.state;
        }
      : undefined,
    createAudioContext: () => new AudioContextConstructor(),
    createWorkletNode: (context) =>
      new AudioWorkletNode(context as AudioContext, "pitch-frame-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      }),
  };
}

function userMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied. Allow it in your browser settings.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found.";
  }
  return "The microphone could not start. Please try again.";
}

export class MicrophoneCapture {
  private readonly environment: MicrophoneEnvironment | null;
  private state: MicrophoneState = INITIAL_STATE;
  private readonly stateListeners = new Set<StateListener>();
  private readonly frameListeners = new Set<FrameListener>();
  private stream: StreamLike | null = null;
  private context: AudioContextLike | null = null;
  private source: NodeLike | null = null;
  private worklet: WorkletNodeLike | null = null;

  constructor(
    environment: MicrophoneEnvironment | null = defaultEnvironment(),
  ) {
    this.environment = environment;
  }

  getState(): MicrophoneState {
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

  async start(options: MicrophoneOptions = {}): Promise<void> {
    if (this.state.status === "running" || this.state.status === "requesting") {
      return;
    }
    if (!this.environment) {
      this.update({
        status: "error",
        permission: "unsupported",
        error:
          "This browser does not support the required microphone features.",
      });
      return;
    }
    if (!this.environment.isSecureContext) {
      this.update({
        status: "error",
        permission: "unsupported",
        error: "A secure HTTPS connection is required to use the microphone.",
      });
      return;
    }

    this.update({ status: "requesting", permission: "prompt", error: null });
    try {
      const permission = await this.environment.queryPermission?.();
      if (permission === "denied") {
        this.update({
          status: "error",
          permission: "denied",
          error: "Microphone permission is blocked in the browser.",
        });
        return;
      }
      this.stream = await this.environment.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: options.echoCancellation ?? false,
          noiseSuppression: options.noiseSuppression ?? false,
        },
      });
      this.context = this.environment.createAudioContext();
      await this.context.audioWorklet.addModule(
        "/audio/pitch-frame-worklet.js",
      );
      this.source = this.context.createMediaStreamSource(this.stream);
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
        for (const listener of this.frameListeners) {
          listener(
            frame,
            this.context?.sampleRate ?? 0,
            event.data.audioTimeMs,
          );
        }
      };
      this.source.connect(this.worklet);
      this.update({ status: "running", permission: "granted", error: null });
    } catch (error) {
      await this.releaseResources();
      this.update({
        status: "error",
        permission:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "denied"
            : "prompt",
        error: userMessage(error),
      });
    }
  }

  async stop(): Promise<void> {
    await this.releaseResources();
    this.update({
      status: "stopped",
      permission: this.state.permission,
      error: null,
    });
  }

  private update(state: MicrophoneState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  private async releaseResources(): Promise<void> {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
    }
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    if (this.context) {
      await this.context.close();
    }
    this.worklet = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}
