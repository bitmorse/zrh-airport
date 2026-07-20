import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../data/adsb";
import { ZRH } from "../data/airports";
import { buildAirport } from "../domain/airport";
import { AirportContext } from "../hooks/useAirport";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { FlightDetails } from "./FlightDetails";

// GPWS drives audio; stub it. Route lookup is mocked (mutable) to avoid the network.
vi.mock("../hooks/useGpws", () => ({ useGpws: () => {} }));
const h = vi.hoisted(() => ({ route: null as unknown }));
vi.mock("../hooks/useFlightRoute", () => ({
  useFlightRoute: () => ({ data: h.route, isLoading: false, isError: false }),
}));

const AP = buildAirport(ZRH);

const madToZrh = {
  callsign: "AEA81TY",
  flightIata: "UX81TY",
  airlineName: "Air Europa",
  airlineIata: "UX",
  origin: { iata: "MAD", icao: "LEMD", name: null, municipality: "Madrid", countryIso: "ES" },
  destination: { iata: "ZRH", icao: "LSZH", name: null, municipality: "Zürich", countryIso: "CH" },
};

function item(verticalRateFpm: number): AircraftWithAssignment {
  const ac: Aircraft = {
    hex: "abc123",
    flight: "AEA81TY",
    lat: 47.5,
    lon: 8.7,
    altFt: 3900,
    altGeomFt: 4200,
    onGround: false,
    gs: 233,
    track: 70,
    verticalRateFpm,
    seenPos: 1,
    type: "B738",
    typeDesc: "Boeing 737-800",
    registration: "EC-LXV",
  };
  return { ac, assignment: null };
}

function renderCard(it: AircraftWithAssignment) {
  return render(
    <AirportContext.Provider value={AP}>
      <FlightDetails item={it} lastUpdated={1_000_000} cockpitAudio={false} onClear={() => {}} />
    </AirportContext.Provider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  h.route = madToZrh;
});
afterEach(cleanup);

describe("FlightDetails route sanity-check", () => {
  it("warns when the aircraft is departing ZRH but the route ends at ZRH (stale inbound callsign)", () => {
    renderCard(item(1500)); // climbing out
    expect(screen.getByText("MAD")).toBeInTheDocument();
    expect(screen.getByText(/inbound leg/i)).toBeInTheDocument();
    expect(screen.getByText(/Now departing ZRH/i)).toBeInTheDocument();
  });

  it("shows the route without a warning for a normal arrival into ZRH", () => {
    renderCard(item(-800)); // descending toward the field
    expect(screen.getByText("MAD")).toBeInTheDocument();
    expect(screen.queryByText(/inbound leg/i)).toBeNull();
  });
});
