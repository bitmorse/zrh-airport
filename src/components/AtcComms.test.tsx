import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtcComms } from "./AtcComms";

const DEMO = "https://ridge.tailed0c2.ts.net";

/** Simulate the receiver's frame reporting it is ready (reachable). */
function reportReady(frame: HTMLIFrameElement) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: DEMO,
        source: frame.contentWindow,
        data: { source: "airport-sdr", protocol: 1, type: "ready", channel: "Tower" },
      }),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: "atc:sdr" }));
});
afterEach(cleanup);

describe("AtcComms", () => {
  it("stays hidden until the receiver is reachable, then reveals the box", () => {
    render(<AtcComms icao="LSZH" active={false} />);
    const frame = screen.getByTitle("Tower comms") as HTMLIFrameElement;
    // Mounted (so it can connect) but parked hidden while unreachable.
    expect(frame.parentElement).toHaveAttribute("aria-hidden", "true");

    reportReady(frame);
    expect(frame.parentElement).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("ATC comms · Tower")).toBeInTheDocument();
  });

  it("auto-plays Tower once reachable while the speaker is active", () => {
    render(<AtcComms icao="LSZH" active />);
    const frame = screen.getByTitle("Tower comms") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow as Window, "postMessage");
    reportReady(frame);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ source: "airport-sdr", type: "play" }),
      DEMO,
    );
  });

  it("pauses (does not play) when the speaker is off, but still shows the box", () => {
    render(<AtcComms icao="LSZH" active={false} />);
    const frame = screen.getByTitle("Tower comms") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow as Window, "postMessage");
    reportReady(frame);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pause" }),
      DEMO,
    );
    expect(frame.parentElement).toHaveAttribute("aria-hidden", "false");
  });

  it("renders nothing for an airport with no configured receiver", () => {
    const { container } = render(<AtcComms icao="VTBS" active />);
    expect(container.querySelector("iframe")).toBeNull();
  });
});
