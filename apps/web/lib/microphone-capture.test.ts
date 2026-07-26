import { describe, expect, it, vi } from "vitest";

import {
  MicrophoneCapture,
  type MicrophoneEnvironment,
  type MicrophoneState,
} from "./microphone-capture";

function environment(permission: PermissionState = "granted") {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const port: { onmessage: ((event: MessageEvent<unknown>) => void) | null } = {
    onmessage: null,
  };
  const worklet = { port, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    sampleRate: 48_000,
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const value: MicrophoneEnvironment = {
    isSecureContext: true,
    getUserMedia,
    queryPermission: vi.fn().mockResolvedValue(permission),
    createAudioContext: () => context,
    createWorkletNode: () => worklet,
  };
  return { value, track, source, worklet, context, getUserMedia, port };
}

describe("MicrophoneCapture", () => {
  it("rejects insecure contexts before requesting permission", async () => {
    const browser = environment();
    const capture = new MicrophoneCapture({
      ...browser.value,
      isSecureContext: false,
    });
    await capture.start();
    expect(capture.getState()).toMatchObject({
      status: "error",
      permission: "unsupported",
    });
    expect(browser.getUserMedia).not.toHaveBeenCalled();
  });

  it("reports an explicitly denied permission", async () => {
    const browser = environment("denied");
    const states: MicrophoneState[] = [];
    const capture = new MicrophoneCapture(browser.value);
    capture.subscribe((state) => states.push(state));
    await capture.start();
    expect(states.map(({ status }) => status)).toEqual([
      "idle",
      "requesting",
      "error",
    ]);
    expect(capture.getState().permission).toBe("denied");
  });

  it("starts with unprocessed capture constraints and emits frames", async () => {
    const browser = environment();
    const capture = new MicrophoneCapture(browser.value);
    const frames: Float32Array[] = [];
    capture.onFrame((frame, sampleRate) => {
      expect(sampleRate).toBe(48_000);
      frames.push(frame);
    });
    await capture.start({ echoCancellation: true });

    expect(browser.getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: false,
        echoCancellation: true,
        noiseSuppression: false,
      },
    });
    expect(capture.getState()).toMatchObject({
      status: "running",
      permission: "granted",
    });
    const data = Float32Array.from([0.1, 0.2]).buffer;
    browser.port.onmessage?.(
      new MessageEvent("message", {
        data: { samples: data, audioTimeMs: 100 },
      }),
    );
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0] ?? [])).toEqual(
      expect.arrayContaining([expect.closeTo(0.1), expect.closeTo(0.2)]),
    );
  });

  it("stops tracks and disposes every audio resource", async () => {
    const browser = environment();
    const capture = new MicrophoneCapture(browser.value);
    await capture.start();
    await capture.stop();
    expect(browser.track.stop).toHaveBeenCalledOnce();
    expect(browser.source.disconnect).toHaveBeenCalledOnce();
    expect(browser.worklet.disconnect).toHaveBeenCalledOnce();
    expect(browser.context.close).toHaveBeenCalledOnce();
    expect(browser.port.onmessage).toBeNull();
    expect(capture.getState().status).toBe("stopped");
  });
});
