import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoiseRecorder as Recorder } from "../hooks/useNoiseRecorder";
import { NoiseRecorder, type RecorderCandidate } from "./NoiseRecorder";

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
const base = {
  primaryCallsign: null as string | null,
  candidates: [] as RecorderCandidate[],
  primaryHex: null as string | null,
  onPickPrimary: noop,
  position: null,
  onManualStop: noop,
};

afterEach(cleanup);

describe("NoiseRecorder compact controls", () => {
  it("shows a compact 'Enable mic' pill when the mic is off", () => {
    render(<NoiseRecorder recorder={stubRecorder({})} {...base} />);
    const btn = screen.getByRole("button", { name: /Enable mic/i });
    expect(btn.className).toMatch(/text-xs/);
    expect(btn.className).toMatch(/w-fit/); // not full-width
  });

  it("renders a small 'Rec' pill (not full-width) plus Disable when armed", () => {
    render(<NoiseRecorder recorder={stubRecorder({ isArmed: true })} {...base} />);
    const rec = screen.getByRole("button", { name: /Rec/i });
    expect(rec.textContent).toContain("Rec");
    expect(rec.className).toMatch(/text-xs/);
    expect(rec.className).not.toMatch(/flex-1/); // compact, not stretched
    expect(screen.getByRole("button", { name: /Disable/i })).toBeInTheDocument();
  });

  it("names the primary aircraft while recording", () => {
    render(
      <NoiseRecorder
        recorder={stubRecorder({ isArmed: true, isRecording: true })}
        {...base}
        primaryCallsign="SWR40L"
      />,
    );
    expect(screen.getByText(/Recording SWR40L/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop/i }).textContent).toContain("Stop");
  });

  it("lists nearby candidates with distance and relabels on tap", () => {
    const onPick = vi.fn();
    render(
      <NoiseRecorder
        recorder={stubRecorder({ isArmed: true, isRecording: true })}
        {...base}
        primaryCallsign="SWR40L"
        primaryHex="aaa"
        onPickPrimary={onPick}
        candidates={[
          { hex: "aaa", callsign: "SWR40L", distanceM: 320 },
          { hex: "bbb", callsign: "DLH88", distanceM: 1500 },
        ]}
      />,
    );
    const pick = screen.getByRole("button", { name: "Label as DLH88" });
    expect(pick.textContent).toContain("1.5 km");
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledWith("bbb");
  });
});
