import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NoiseRecorder as Recorder } from "../hooks/useNoiseRecorder";
import { NoiseRecorder } from "./NoiseRecorder";

function stubRecorder(over: Partial<Recorder>): Recorder {
  return {
    isArmed: false,
    isRecording: false,
    level: -60,
    error: null,
    arm: async () => {},
    disarm: () => {},
    startRecording: () => {},
    stopRecording: async () => ({ blob: null, peakDbfs: -60, avgDbfs: -60, durationMs: 0 }),
    ...over,
  };
}

const noop = () => {};

afterEach(cleanup);

describe("NoiseRecorder compact controls", () => {
  it("shows a compact 'Enable mic' pill when the mic is off", () => {
    render(
      <NoiseRecorder recorder={stubRecorder({})} activeCallsign={null} position={null} onManualStop={noop} />,
    );
    const btn = screen.getByRole("button", { name: /Enable mic/i });
    expect(btn.className).toMatch(/text-xs/);
    expect(btn.className).toMatch(/w-fit/); // not full-width
  });

  it("renders a small 'Rec' pill (not full-width) plus Disable when armed", () => {
    render(
      <NoiseRecorder
        recorder={stubRecorder({ isArmed: true })}
        activeCallsign={null}
        position={null}
        onManualStop={noop}
      />,
    );
    const rec = screen.getByRole("button", { name: /Rec/i });
    expect(rec.textContent).toContain("Rec");
    expect(rec.className).toMatch(/text-xs/);
    expect(rec.className).not.toMatch(/flex-1/); // compact, not stretched
    expect(screen.getByRole("button", { name: /Disable/i })).toBeInTheDocument();
  });

  it("switches the pill to 'Stop' while recording", () => {
    render(
      <NoiseRecorder
        recorder={stubRecorder({ isArmed: true, isRecording: true })}
        activeCallsign="SWR40L"
        position={null}
        onManualStop={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Stop/i }).textContent).toContain("Stop");
  });
});
