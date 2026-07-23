import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../data/adsb";
import type { FlightRoute } from "../data/flightInfo";
import type { TrackedFlight } from "../hooks/useTrackedFlight";
import { FlightReadout } from "./FlightReadout";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const route: FlightRoute = {
  callsign: "SWR40",
  flightIata: "LX40",
  airlineName: "Swiss",
  airlineIata: "LX",
  airlineIcao: "SWR",
  origin: { iata: "GVA", icao: "LSGG", name: "Geneva", municipality: "Geneva", countryIso: "CH", lat: 46.23, lon: 6.11 },
  destination: { iata: "JFK", icao: "KJFK", name: "JFK", municipality: "New York", countryIso: "US", lat: 40.64, lon: -73.78 },
};

const ac: Aircraft = {
  hex: "4b1620",
  flight: "SWR40",
  lat: 47,
  lon: 8,
  gs: 480,
  track: 290,
  onGround: false,
  altFt: 36000,
  verticalRateFpm: 0,
  type: "A333",
  registration: "HB-JHA",
} as Aircraft;

const following: TrackedFlight = {
  aircraft: ac,
  callsign: "SWR40",
  route,
  status: "following",
  lastUpdated: Date.now(),
  error: null,
};

describe("FlightReadout", () => {
  it("shows flight number, aircraft type, airline and a timing headline", () => {
    render(<FlightReadout tracked={following} onExit={() => {}} />);
    expect(screen.getByText("LX40")).toBeInTheDocument(); // IATA flight number
    expect(screen.getByText("A333")).toBeInTheDocument(); // aircraft type
    expect(screen.getByText(/Swiss/)).toBeInTheDocument(); // airline
    expect(screen.getByText(/HB-JHA/)).toBeInTheDocument(); // registration
    expect(screen.getByText("En route")).toBeInTheDocument(); // phase pill
    expect(screen.getByText(/Arrives JFK in/)).toBeInTheDocument(); // ETA timing
    // Origin/destination strip.
    expect(screen.getByText("GVA")).toBeInTheDocument();
    expect(screen.getByText("JFK")).toBeInTheDocument();
  });

  it("exits when Exit is tapped", () => {
    const onExit = vi.fn();
    render(<FlightReadout tracked={following} onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: /Exit/i }));
    expect(onExit).toHaveBeenCalled();
  });

  it("shows a searching state before the aircraft is found", () => {
    render(
      <FlightReadout
        tracked={{ aircraft: null, callsign: null, route: null, status: "searching", lastUpdated: null, error: null }}
        onExit={() => {}}
      />,
    );
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.getByText(/Looking for this flight/)).toBeInTheDocument();
  });
});
