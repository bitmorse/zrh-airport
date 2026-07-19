import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../data/adsb";
import type { DepartureEvent } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { ArrivalsBoard } from "./ArrivalsBoard";

const NOW = 1_000_000;

function acItem(hex: string, type: string | null): AircraftWithAssignment {
  const ac: Aircraft = {
    hex,
    flight: null,
    lat: 0,
    lon: 0,
    altFt: null,
    altGeomFt: null,
    onGround: false,
    gs: 150,
    track: 280,
    verticalRateFpm: -700,
    seenPos: 1,
    type,
    typeDesc: null,
    registration: null,
  };
  return { ac, assignment: null };
}

const arr = (hex: string, end: string, etaSeconds: number, distanceNm: number, callsign: string): Arrival => ({
  end,
  strip: "10/28",
  hex,
  callsign,
  etaSeconds,
  distanceNm,
  gsKt: 150,
});

const dep = (hex: string, end: string): DepartureEvent => ({
  end,
  strip: "14/32",
  hex,
  callsign: "SWR12",
  phase: "holding",
  gsKt: 0,
  holdingSinceMs: NOW - 30_000,
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("ArrivalsBoard (runway status)", () => {
  it("shows a config header and one row per active end, no empty rows", () => {
    render(
      <ArrivalsBoard
        arrivals={[
          arr("a1", "34", 90, 4, "SWR40L"),
          arr("a2", "34", 200, 9, "DLH4AB"), // same end → "+1"
          arr("a3", "28", 0, 0, "EDW8LM"), // landing (eta 0)
        ]}
        departures={[dep("d1", "32")]}
        aircraft={[acItem("a1", "A320"), acItem("a2", "B738"), acItem("a3", "A320"), acItem("d1", "A359")]}
        now={NOW}
        lastUpdated={NOW}
      />,
    );

    expect(screen.getByText("Runway status")).toBeInTheDocument();
    expect(screen.getByText("↓ 34 · 28")).toBeInTheDocument(); // landing config
    expect(screen.getByText("↑ 32")).toBeInTheDocument(); // departing config

    // A landed aircraft keeps the "landing" label; a fresh inbound shows type + "+1".
    expect(screen.getByText("landing")).toBeInTheDocument();
    expect(screen.getByText("SWR40L")).toBeInTheDocument();
    expect(screen.getAllByText(/A320/).length).toBeGreaterThan(0);
    expect(screen.getByText("+1")).toBeInTheDocument();

    // No fixed/empty runway rows like the old board.
    expect(screen.queryByText(/no inbound/i)).toBeNull();
  });

  it("selects an aircraft when its row is tapped", () => {
    const onSelect = vi.fn();
    render(
      <ArrivalsBoard
        arrivals={[arr("a1", "34", 90, 4, "SWR40L")]}
        departures={[]}
        aircraft={[acItem("a1", "A320")]}
        now={NOW}
        lastUpdated={NOW}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("SWR40L"));
    expect(onSelect).toHaveBeenCalledWith("a1");
  });
});
