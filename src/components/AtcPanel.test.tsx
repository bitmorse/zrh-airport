import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAirport } from "../domain/airport";
import type { DepartureEvent } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import { ZRH } from "../data/airports";
import { AirportContext } from "../hooks/useAirport";
import { AtcPanel } from "./AtcPanel";

const AP = buildAirport(ZRH);
const DEMO = "https://ridge.tailed0c2.ts.net";

function renderPanel(arrivals: Arrival[], departures: DepartureEvent[], onSelect = vi.fn()) {
  return {
    onSelect,
    ...render(
      <AirportContext.Provider value={AP}>
        <AtcPanel arrivals={arrivals} departures={departures} now={1_000_000} onSelect={onSelect} />
      </AirportContext.Provider>,
    ),
  };
}

/** Simulate a message from a channel's embedded frame (validated by origin + source). */
function frameMessage(iframe: HTMLIFrameElement, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: DEMO,
        source: iframe.contentWindow,
        data: { source: "airport-sdr", protocol: 1, ...data },
      }),
    );
  });
}

const arrival: Arrival = {
  end: "34",
  strip: "16/34",
  hex: "aaa",
  callsign: "SWR123",
  etaSeconds: 60,
  distanceNm: 3,
  gsKt: 150,
};

beforeEach(() => {
  localStorage.clear();
  // Reset the module-level receiver-config cache so demo defaults apply per test.
  window.dispatchEvent(new StorageEvent("storage", { key: "atc:sdr" }));
});
afterEach(cleanup);

describe("AtcPanel", () => {
  it("ships the Zurich demo receiver + Tower channel prefilled, others empty", () => {
    renderPanel([arrival], []);
    expect(screen.getByLabelText("Receiver URL")).toHaveValue(DEMO);
    expect(screen.getByLabelText("Tower channel name")).toHaveValue("Tower");
    expect(screen.getByLabelText("Approach channel name")).toHaveValue("");

    // The only configured channel gets an embedded frame pointing at /embed/<channel>.
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toContain(`${DEMO}/embed/Tower?origin=`);
    expect(frame).toHaveAttribute("allow", "autoplay");

    // Unconfigured positions show only their input — no frame, no repeated helper text.
    expect(screen.queryByTitle(/Approach —/)).toBeNull();

    // No LiveATC bundling anymore.
    expect(screen.queryByRole("link", { name: /Find/i })).toBeNull();
    // Published reference frequencies still show.
    expect(screen.getByText("118.100")).toBeInTheDocument();
  });

  it("lists no channels until a receiver URL is set", () => {
    renderPanel([], []);
    fireEvent.change(screen.getByLabelText("Receiver URL"), { target: { value: "" } });
    expect(screen.getByText("Add your receiver URL above to list its channels.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tower channel name")).toBeNull();
  });

  it("embeds a channel once a receiver URL and channel name are set", () => {
    renderPanel([], []);
    fireEvent.change(screen.getByLabelText("Receiver URL"), {
      target: { value: "https://my-receiver.example" },
    });
    fireEvent.change(screen.getByLabelText("Ground channel name"), {
      target: { value: "Apron S" },
    });
    const frame = screen.getByTitle("Ground — Apron S") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toContain(
      "https://my-receiver.example/embed/Apron%20S?origin=",
    );
  });

  it("shows who's on frequency once a channel reports it is playing", async () => {
    const { onSelect } = renderPanel([arrival], []);
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;

    // Nothing is playing yet → no on-frequency panel.
    expect(screen.queryByText(/active 34/)).toBeNull();

    frameMessage(frame, { type: "ready", channel: "Tower", frequency: 118.1 });
    frameMessage(frame, { type: "state", playing: true });

    expect(await screen.findByText(/active 34/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /SWR123/ }));
    expect(onSelect).toHaveBeenCalledWith("aaa");

    // When it stops, the on-frequency panel goes away.
    frameMessage(frame, { type: "state", playing: false });
    expect(screen.queryByText(/active 34/)).toBeNull();
  });

  it("shows a connecting note that clears once the frame is ready", () => {
    renderPanel([], []);
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;
    expect(screen.getByText(/Connecting to receiver/)).toBeInTheDocument();
    frameMessage(frame, { type: "ready", channel: "Tower", frequency: 118_100_000 });
    // Once live, the frame is the display — we add no chrome of our own.
    expect(screen.queryByText(/Connecting to receiver/)).toBeNull();
  });

  it("surfaces a reported error (e.g. origin not allow-listed)", () => {
    renderPanel([], []);
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;
    frameMessage(frame, { type: "error", code: "origin-not-allowed" });
    expect(screen.getByText(/isn.t allow-listed on the receiver/)).toBeInTheDocument();
  });
});
