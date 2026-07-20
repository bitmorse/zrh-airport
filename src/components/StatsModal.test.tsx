import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZRH } from "../data/airports";
import type { WatchedFlight } from "../data/watchStore";
import { buildAirport } from "../domain/airport";
import { AirportContext } from "../hooks/useAirport";
import { StatsModal } from "./StatsModal";

const AP = buildAirport(ZRH);

const flight: WatchedFlight = {
  id: "1",
  hex: "abc",
  callsign: "SWR40L",
  type: "A320",
  registration: "HB-JCA",
  kind: "landing",
  end: "34",
  completedAt: 1_700_000_000_000,
  points: 2,
  hadGpsAudio: true,
  trajectory: [
    { lat: 47.5, lon: 8.6, alt: 4000, t: 1 },
    { lat: 47.48, lon: 8.58, alt: 2000, t: 2 },
    { lat: 47.46, lon: 8.56, alt: 500, t: 3 },
  ],
};

// Feed a controllable watched list; stub NoiseTable (idb) for the measurements tab.
const h = vi.hoisted(() => ({ watched: [] as WatchedFlight[] }));
vi.mock("../hooks/useWatchedFlights", () => ({
  useWatchedFlights: () => ({ watched: h.watched, remove: async () => {} }),
}));
vi.mock("./NoiseTable", () => ({ NoiseTable: () => <div>measurements-stub</div> }));

function renderModal() {
  return render(
    <AirportContext.Provider value={AP}>
      <StatsModal onClose={() => {}} />
    </AirportContext.Provider>,
  );
}

afterEach(cleanup);

describe("StatsModal", () => {
  it("shows the empty state with a zero score", () => {
    h.watched = [];
    renderModal();
    expect(screen.getByText("Flights watched")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/No flights watched yet/i)).toBeInTheDocument();
  });

  it("lists watched flights with a sparkline, opens the trajectory sheet, and switches tabs", () => {
    h.watched = [flight];
    const { container } = renderModal();

    expect(screen.getByText("2")).toBeInTheDocument(); // total score (one 2× flight)
    expect(screen.getByText("SWR40L")).toBeInTheDocument();
    expect(container.querySelector("svg[aria-label='Altitude trace']")).not.toBeNull();

    fireEvent.click(screen.getByText("SWR40L")); // → trajectory sheet
    expect(screen.getByText("← Back")).toBeInTheDocument();
    expect(container.querySelector("svg[aria-label='Flight trajectory map']")).not.toBeNull();

    fireEvent.click(screen.getByText("← Back"));
    fireEvent.click(screen.getByRole("button", { name: "measurements" }));
    expect(screen.getByText("measurements-stub")).toBeInTheDocument();
  });
});
