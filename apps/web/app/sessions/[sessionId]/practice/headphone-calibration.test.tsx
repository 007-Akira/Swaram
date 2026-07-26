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
          requestPermission: vi.fn(),
          calibrateLeakage: vi.fn(),
        }}
        onReady={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        /ബ്രൗസറിന് ഹെഡ്ഫോൺ ധരിച്ചിട്ടുണ്ടെന്ന് ഉറപ്പാക്കാൻ കഴിയില്ല/,
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
          requestPermission: vi.fn().mockResolvedValue(undefined),
          calibrateLeakage,
        }}
        onReady={onReady}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "മൈക്രോഫോൺ അനുവദിക്കുക" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "ചോർച്ച പരിശോധിക്കുക" }),
    );
    expect(await screen.findByText(/പ്ലേബാക്ക് കൂടുതലായി/)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /പരിശോധനയ്ക്കായി മാത്രം/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ചോർച്ച പരിശോധിക്കുക" }),
    );
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(calibrateLeakage).toHaveBeenLastCalledWith(true);
  });
});
