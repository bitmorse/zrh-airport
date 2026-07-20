import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../data/adsb";
import type { DepartureEvent } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { TrafficBar } from "./TrafficBar";

// Route lookup hits the network and needs react-query; stub it (mutable) for pure UI tests.
const h = vi.hoisted(() => ({ route: null as unknown }));
vi.mock("../hooks/useFlightRoute", () => ({
  useFlightRoute: () => ({ data: h.route, isLoading: false, isError: false }),
}));

const NOW = 1_000_000;

const arrival: Arrival = {
  end: "34",
  strip: "16/34",
  hex: "arr1",
  callsign: "SWR40L",
  etaSeconds: 90,
  distanceNm: 4,
  gsKt: 150,
};

function holding(hex: string, callsign: string, sinceMs: number): DepartureEvent {
  return { end: "28", strip: "10/28", hex, callsign, phase: "holding", gsKt: 0, holdingSinceMs: sinceMs };
}

/** Minimal aircraft-with-assignment carrying just the hex + type the bar reads. */
function acItem(hex: string, type: string | null): AircraftWithAssignment {
  return { ac: { hex, type } as unknown as Aircraft, assignment: null };
}

beforeEach(() => {
  localStorage.clear();
  h.route = null;
});
afterEach(cleanup);

describe("TrafficBar", () => {
  it("renders a departure in the same row format (no chips) with a live timer", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TrafficBar
        arrivals={[arrival]}
        departures={[holding("d1", "THA936", NOW - 37_000)]}
        now={NOW}
        lastUpdated={NOW}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("SWR40L")).toBeInTheDocument(); // arrival row
    expect(screen.getByText(/waiting/)).toBeInTheDocument(); // departure state
    expect(screen.getByText("0:37")).toBeInTheDocument(); // live wait timer

    // No pill/ring/background chip styling survives on any row.
    expect(container.querySelectorAll('[class*="ring-"]').length).toBe(0);
    expect(container.querySelector('[class*="bg-amber"]')).toBeNull();

    fireEvent.click(screen.getByText("THA936"));
    expect(onSelect).toHaveBeenCalledWith("d1");
  });

  it("shows the aircraft type and a compact origin→dest route, not the airline name", () => {
    h.route = {
      airlineName: "Air Canada",
      flightIata: "AC880",
      origin: { iata: "YYZ" },
      destination: { iata: "ZRH" },
    };
    render(
      <TrafficBar
        arrivals={[arrival]}
        departures={[holding("d1", "EJU69MT", NOW - 13_000)]}
        aircraft={[acItem("arr1", "B77L"), acItem("d1", "A320")]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );
    // The leading runway number is labelled so it isn't a mystery.
    expect(screen.getAllByText("RWY").length).toBeGreaterThan(0);
    expect(screen.getByTitle("Runway 34 · SWR40L")).toBeInTheDocument();

    // Arrival row: compact "type · origin→dest"; the airline name is gone.
    expect(screen.getByText(/B77L · YYZ→ZRH/)).toBeInTheDocument();
    expect(screen.queryByText(/Air Canada/)).toBeNull();
    // Departure row: "type · phase".
    expect(screen.getByText(/A320 · waiting/)).toBeInTheDocument();
  });

  it("flashes an approach gate while the crossing is recent, then stops", () => {
    const { rerender } = render(
      <TrafficBar
        arrivals={[{ ...arrival, flash: { label: "decision height", atMs: NOW - 2000 } }]}
        departures={[]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );
    expect(screen.getByText(/decision height/)).toBeInTheDocument();

    rerender(
      <TrafficBar
        arrivals={[{ ...arrival, flash: { label: "decision height", atMs: NOW - 10_000 } }]}
        departures={[]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );
    expect(screen.queryByText(/decision height/)).toBeNull();
  });

  it("marks the selected row (aria-pressed) without using a callout colour", () => {
    render(
      <TrafficBar
        arrivals={[arrival]}
        departures={[]}
        now={NOW}
        lastUpdated={NOW}
        selectedHex="arr1"
        onSelect={() => {}}
      />,
    );
    const row = screen.getByRole("button", { pressed: true });
    expect(row).toHaveTextContent("SWR40L");
    // Neutral surface selection tint, not a status/callout colour.
    expect(row.className).toMatch(/bg-surface-container/);
    expect(row.className).not.toMatch(/bg-status-(arrival|departure|cleared|alert)/);
  });

  it("also shows the selected arrival when it isn't the soonest", () => {
    const soonest = { ...arrival, hex: "soon", callsign: "SOON1", etaSeconds: 60 };
    const later = { ...arrival, hex: "later", callsign: "LATER2", etaSeconds: 240 };
    render(
      <TrafficBar
        arrivals={[soonest, later]}
        departures={[]}
        now={NOW}
        lastUpdated={NOW}
        selectedHex="later"
        onSelect={() => {}}
      />,
    );
    // Both the soonest and the selected (non-soonest) arrival have rows.
    expect(screen.getByText("SOON1")).toBeInTheDocument();
    expect(screen.getByText("LATER2")).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("LATER2");
  });

  it("surfaces a selected departure even when it's beyond the cap", () => {
    render(
      <TrafficBar
        arrivals={[]}
        departures={[
          holding("d0", "DEP0", NOW),
          holding("d1", "DEP1", NOW),
          holding("d2", "DEP2", NOW),
          holding("d3", "DEP3", NOW),
          holding("d4", "DEP4", NOW),
        ]}
        now={NOW}
        lastUpdated={NOW}
        selectedHex="d4"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("DEP4")).toBeInTheDocument(); // shown despite the cap
    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("DEP4");
    expect(screen.getByText("+1 more departing")).toBeInTheDocument();
  });

  it("shows a selected in-range aircraft with no movement row", () => {
    render(
      <TrafficBar
        arrivals={[arrival]}
        departures={[]}
        aircraft={[acItem("arr1", "B77L"), acItem("wander", "C25A")]}
        now={NOW}
        lastUpdated={NOW}
        selectedHex="wander"
        onSelect={() => {}}
      />,
    );
    const row = screen.getByRole("button", { pressed: true });
    expect(row).toHaveTextContent("WANDER");
    expect(row).toHaveTextContent(/in range/);
  });

  it("caps the list at 3 departures and shows a '+N more' line", () => {
    render(
      <TrafficBar
        arrivals={[]}
        departures={[
          holding("d0", "DEP0", NOW),
          holding("d1", "DEP1", NOW),
          holding("d2", "DEP2", NOW),
          holding("d3", "DEP3", NOW),
          holding("d4", "DEP4", NOW),
        ]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );
    expect(screen.getByText("No inbound traffic")).toBeInTheDocument();
    expect(screen.getByText("DEP0")).toBeInTheDocument();
    expect(screen.getByText("DEP2")).toBeInTheDocument();
    expect(screen.queryByText("DEP3")).toBeNull();
    expect(screen.getByText("+2 more departing")).toBeInTheDocument();
  });
});
