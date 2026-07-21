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
  it("ships the Zurich demo: receiver URL + a Tower player, editor collapsed", () => {
    renderPanel([arrival], []);
    expect(screen.getByLabelText("Receiver URL")).toHaveValue(DEMO);

    // The configured channel shows as a player — not an input stacked over a player.
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toContain(`${DEMO}/embed/Tower?origin=`);
    expect(frame).toHaveAttribute("allow", "autoplay");
    // Channel-name inputs live behind the editor, not in the default view.
    expect(screen.queryByLabelText("Tower channel name")).toBeNull();
    expect(screen.getByRole("button", { name: /Edit channels/i })).toBeInTheDocument();

    // Link to run your own receiver; no LiveATC bundling anymore.
    expect(screen.getByRole("link", { name: /Set up your own/i })).toHaveAttribute(
      "href",
      "https://github.com/bitmorse/airport-sdr",
    );
    expect(screen.queryByRole("link", { name: /Find/i })).toBeNull();
    expect(screen.getByText("118.100")).toBeInTheDocument();
  });

  it("edits channel names behind the editor and adds a new position", () => {
    renderPanel([], []);
    fireEvent.click(screen.getByRole("button", { name: /Edit channels/i }));

    expect(screen.getByLabelText("Tower channel name")).toHaveValue("Tower");
    expect(screen.getByLabelText("Ground channel name")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Ground channel name"), {
      target: { value: "Apron S" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Done/i }));

    // Back in the player view, the new channel is now a player.
    const frame = screen.getByTitle("Ground — Apron S") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toContain(`${DEMO}/embed/Apron%20S?origin=`);
  });

  it("lists no channels until a receiver URL is set", () => {
    renderPanel([], []);
    fireEvent.change(screen.getByLabelText("Receiver URL"), { target: { value: "" } });
    expect(
      screen.getByText("Add your receiver URL above to list its channels."),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Tower — Tower")).toBeNull();
  });

  it("shows who's on frequency once a channel reports it is playing", async () => {
    const { onSelect } = renderPanel([arrival], []);
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;

    expect(screen.queryByText(/active 34/)).toBeNull();
    frameMessage(frame, { type: "ready", channel: "Tower", frequency: 118_100_000 });
    frameMessage(frame, { type: "state", playing: true });

    expect(await screen.findByText(/active 34/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /SWR123/ }));
    expect(onSelect).toHaveBeenCalledWith("aaa");

    frameMessage(frame, { type: "state", playing: false });
    expect(screen.queryByText(/active 34/)).toBeNull();
  });

  it("shows a connecting note that clears once the frame is ready", () => {
    renderPanel([], []);
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;
    expect(screen.getByText(/Connecting to receiver/)).toBeInTheDocument();
    frameMessage(frame, { type: "ready", channel: "Tower", frequency: 118_100_000 });
    expect(screen.queryByText(/Connecting to receiver/)).toBeNull();
  });

  it("surfaces a reported error (e.g. origin not allow-listed)", () => {
    renderPanel([], []);
    const frame = screen.getByTitle("Tower — Tower") as HTMLIFrameElement;
    frameMessage(frame, { type: "error", code: "origin-not-allowed" });
    expect(screen.getByText(/isn.t allow-listed on the receiver/)).toBeInTheDocument();
  });
});
