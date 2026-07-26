import { describe, expect, it, vi } from "vitest";

import {
  AudioSessionController,
  type AudioSessionEnvironment,
  type AudioSessionStatus,
} from "./audio-session";

function environment() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const microphoneSource = { connect: vi.fn(), disconnect: vi.fn() };
  const playbackSource = { connect: vi.fn(), disconnect: vi.fn() };
  const destination = { connect: vi.fn(), disconnect: vi.fn() };
  const port: { onmessage: ((event: MessageEvent<unknown>) => void) | null } = {
    onmessage: null,
  };
  const worklet = { port, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    sampleRate: 48_000,
    baseLatency: 0.01,
    outputLatency: 0.02,
    destination,
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaElementSource: vi.fn(() => playbackSource),
    createMediaStreamSource: vi.fn(() => microphoneSource),
    createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null,
        onended: null as ((event: Event) => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(() =>
          queueMicrotask(() => source.onended?.(new Event("ended"))),
        ),
      };
      return source;
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const playback = {
    src: "",
    currentTime: 0,
    duration: 60,
    paused: true,
    readyState: 1,
    loop: false,
    playbackRate: 1,
    volume: 1,
    addEventListener: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
    remove: vi.fn(),
  };
  let visibilityListener: (() => void) | null = null;
  let hidden = false;
  const value: AudioSessionEnvironment = {
    isSecureContext: true,
    getUserMedia: vi.fn().mockResolvedValue(stream),
    createAudioContext: vi.fn(() => context),
    createWorkletNode: vi.fn(() => worklet),
    createPlaybackElement: vi.fn(() => playback),
    addVisibilityListener: vi.fn((listener) => {
      visibilityListener = listener;
    }),
    removeVisibilityListener: vi.fn(),
    isDocumentHidden: () => hidden,
  };
  return {
    value,
    track,
    microphoneSource,
    playbackSource,
    worklet,
    context,
    playback,
    port,
    setHidden(value: boolean) {
      hidden = value;
    },
    dispatchVisibility() {
      visibilityListener?.();
    },
  };
}

async function readyController(browser: ReturnType<typeof environment>) {
  const controller = new AudioSessionController(
    { playbackUrl: "private:instrumental" },
    browser.value,
  );
  await controller.requestPermission();
  controller.completeCalibration();
  return controller;
}

describe("AudioSessionController", () => {
  it("follows the legal permission, calibration, and playback transitions", async () => {
    const browser = environment();
    const controller = new AudioSessionController(
      { playbackUrl: "private:instrumental" },
      browser.value,
    );
    const states: AudioSessionStatus[] = [];
    controller.subscribe(({ status }) => states.push(status));

    await controller.requestPermission();
    controller.completeCalibration();
    await controller.play();
    controller.pause();
    await controller.play();
    await controller.stop();

    expect(states).toEqual([
      "idle",
      "requesting_permission",
      "calibrating",
      "ready",
      "playing",
      "paused",
      "playing",
      "stopped",
    ]);
    expect(browser.value.createAudioContext).toHaveBeenCalledOnce();
    expect(browser.value.createPlaybackElement).toHaveBeenCalledOnce();
  });

  it("rejects illegal state transitions", async () => {
    const browser = environment();
    const controller = new AudioSessionController(
      { playbackUrl: "private:instrumental" },
      browser.value,
    );
    expect(() => controller.completeCalibration()).toThrow(
      "Illegal audio session transition",
    );
    await expect(controller.play()).rejects.toThrow("Cannot play");
  });

  it("runs an original calibration signal before becoming ready", async () => {
    const browser = environment();
    const controller = new AudioSessionController(
      { playbackUrl: "private:instrumental" },
      browser.value,
    );
    await controller.requestPermission();
    const calibration = controller.calibrateLeakage();
    browser.port.onmessage?.(
      new MessageEvent("message", {
        data: {
          samples: new Float32Array(4_096).buffer,
          audioTimeMs: 100,
        },
      }),
    );
    const result = await calibration;
    expect(result.level).toBe("inconclusive");
    expect(controller.getState().status).toBe("ready");
    expect(browser.context.createBufferSource).toHaveBeenCalledOnce();
  });

  it("emits stable pitch frames timestamped by the audio worklet clock", async () => {
    const browser = environment();
    const controller = new AudioSessionController(
      { playbackUrl: "private:instrumental", pitchDebug: true },
      browser.value,
    );
    const frames: import("@swaram/audio-core").LivePitchFrame[] = [];
    controller.onPitchFrame((frame) => frames.push(frame));
    await controller.requestPermission();
    browser.port.onmessage?.(
      new MessageEvent("message", {
        data: {
          samples: new Float32Array(4_096).buffer,
          audioTimeMs: 321,
        },
      }),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      timeMs: 321,
      voiced: false,
      debug: { rawFrequencyHz: null },
    });
  });

  it("stores browser latency and allows a guided manual nudge", async () => {
    const browser = environment();
    const controller = new AudioSessionController(
      { playbackUrl: "private:instrumental" },
      browser.value,
    );
    await controller.requestPermission();
    expect(controller.estimateLatency()).toBe(30);
    expect(controller.nudgeLatency(15)).toBe(45);
    expect(controller.getState().latencyOffsetMs).toBe(45);
    browser.playback.currentTime = 1;
    expect(controller.getPracticeTime()).toMatchObject({
      rawSongTimeMs: 1_000,
      comparisonTimeMs: 955,
      latencyApplied: true,
    });
  });

  it("restarts and resumes without creating duplicate audio nodes", async () => {
    const browser = environment();
    const controller = await readyController(browser);
    await controller.play();
    browser.playback.currentTime = 12;
    controller.pause();
    await controller.restart();

    expect(browser.playback.currentTime).toBe(0);
    expect(browser.playback.play).toHaveBeenCalledTimes(2);
    expect(browser.value.createWorkletNode).toHaveBeenCalledOnce();
    expect(browser.context.createMediaElementSource).toHaveBeenCalledOnce();
    expect(browser.context.createMediaStreamSource).toHaveBeenCalledOnce();
  });

  it("switches aligned playback modes without replacing the clock or nodes", async () => {
    const browser = environment();
    const controller = await readyController(browser);
    browser.playback.currentTime = 12.5;
    await controller.switchPlaybackSource("private:original");
    expect(browser.playback.src).toBe("private:original");
    expect(browser.playback.currentTime).toBe(12.5);
    expect(controller.getPracticeTime().rawSongTimeMs).toBe(12_500);
    expect(browser.context.createMediaElementSource).toHaveBeenCalledOnce();
    controller.setAccompanimentVolume(0.4);
    expect(browser.playback.volume).toBe(0.4);
  });

  it("releases the microphone and every audio node exactly once", async () => {
    const browser = environment();
    const controller = await readyController(browser);
    await controller.stop();
    await controller.stop();

    expect(browser.track.stop).toHaveBeenCalledOnce();
    expect(browser.microphoneSource.disconnect).toHaveBeenCalledOnce();
    expect(browser.playbackSource.disconnect).toHaveBeenCalledOnce();
    expect(browser.worklet.disconnect).toHaveBeenCalledOnce();
    expect(browser.context.close).toHaveBeenCalledOnce();
    expect(browser.worklet.port.onmessage).toBeNull();
  });

  it("cleans up when the route disposes or the document becomes hidden", async () => {
    const browser = environment();
    const controller = await readyController(browser);
    browser.setHidden(true);
    browser.dispatchVisibility();
    await vi.waitFor(() =>
      expect(controller.getState().status).toBe("stopped"),
    );
    expect(browser.track.stop).toHaveBeenCalledOnce();

    await controller.dispose();
    expect(browser.value.removeVisibilityListener).toHaveBeenCalledOnce();
    await expect(controller.requestPermission()).rejects.toThrow("disposed");
  });

  it("stops a microphone stream returned after visibility cleanup", async () => {
    const browser = environment();
    let resolvePermission!: (stream: {
      getTracks(): { stop(): void }[];
    }) => void;
    const delayedTrack = { stop: vi.fn() };
    const delayedEnvironment: AudioSessionEnvironment = {
      ...browser.value,
      getUserMedia: vi.fn(
        () =>
          new Promise<{ getTracks(): { stop(): void }[] }>((resolve) => {
            resolvePermission = resolve;
          }),
      ),
    };
    const controller = new AudioSessionController(
      { playbackUrl: "private:instrumental" },
      delayedEnvironment,
    );

    const request = controller.requestPermission();
    browser.setHidden(true);
    browser.dispatchVisibility();
    await vi.waitFor(() =>
      expect(controller.getState().status).toBe("stopped"),
    );
    resolvePermission({ getTracks: () => [delayedTrack] });
    await request;

    expect(delayedTrack.stop).toHaveBeenCalledOnce();
    expect(delayedEnvironment.createAudioContext).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("stopped");
  });
});
