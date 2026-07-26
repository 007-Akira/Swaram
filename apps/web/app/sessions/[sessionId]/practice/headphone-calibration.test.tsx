import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeadphoneCalibration } from "./headphone-calibration";

const result = (canContinue: boolean) => ({
  level: "high" as const,
  canContinue,
  microphoneRms: 0.1,
  peakCorrelation: 0.8,
  lagSamples: 40,
});

describe("HeadphoneCalibration", () => {
  afterEach(() => cleanup());

  it("honestly explains the browser limitation", () => {
    render(
      <HeadphoneCalibration
        controller={{
          getState: () => ({ status: "idle" }),
          requestPermission: vi.fn(),
          calibrateLeakage: vi.fn(),
        }}
        onReady={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        /browser cannot confirm that you are wearing headphones/i,
      ),
    ).toBeInTheDocument();
  });

  it("blocks high leakage and exposes a testing override", async () => {
    const calibrateLeakage = vi
      .fn()
      .mockResolvedValueOnce(result(false))
      .mockResolvedValueOnce(result(true));
    const onReady = vi.fn();
    render(
      <HeadphoneCalibration
        controller={{
          getState: () => ({ status: "calibrating" }),
          requestPermission: vi.fn().mockResolvedValue(undefined),
          calibrateLeakage,
        }}
        onReady={onReady}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Allow microphone" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Check leakage" }),
    );
    expect(await screen.findByText(/too much playback/i)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /for testing only/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check leakage" }),
    );
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(calibrateLeakage).toHaveBeenLastCalledWith(true);
  });
});
