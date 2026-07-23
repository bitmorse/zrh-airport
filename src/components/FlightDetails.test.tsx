import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../data/adsb";
import { ZRH } from "../data/airports";
import { buildAirport } from "../domain/airport";
import { AirportContext } from "../hooks/useAirport";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { FlightDetails } from "./FlightDetails";

// GPWS drives audio; stub it. Route lookup is mocked (mutable) to avoid the network.
vi.mock("../hooks/useGpws", () => ({ useGpws: () => ({ callout: null }) }));
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
      <FlightDetails
        item={it}
        status={{ label: null }}
        lastUpdated={1_000_000}
        cockpitActive={false}
        cockpitAudio={false}
        onClear={() => {}}
      />
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

  it("renders the AeroAPI schedule (status, gate, times) for a searched flight", () => {
    h.route = null; // off radar: no adsbdb route, only the AeroAPI lookup
    render(
      <AirportContext.Provider value={AP}>
        <FlightDetails
          item={item(0)}
          status={{ label: null }}
          lastUpdated={1_000_000}
          lookup={{
            faFlightId: "AUA146-1",
            identIata: "OS146",
            aircraftType: "A320",
            operator: "Austrian",
            status: "Scheduled",
            progressPercent: 0,
            cancelled: false,
            diverted: false,
            positionOnly: false,
            origin: { icao: "LSZH", iata: "ZRH", name: "Zurich", city: "Zurich" },
            destination: { icao: "LOWW", iata: "VIE", name: "Vienna", city: "Vienna" },
            gateOrigin: "A84",
            gateDestination: "F",
            terminalDestination: "3",
            scheduledOut: "2026-07-23T18:50:00Z",
            estimatedOut: "2026-07-23T19:00:00Z",
            departureDelay: 600,
            scheduledIn: "2026-07-23T20:10:00Z",
            estimatedIn: "2026-07-23T20:13:00Z",
            arrivalDelay: 180,
          } as unknown as Parameters<typeof FlightDetails>[0]["lookup"]}
          cockpitActive={false}
          cockpitAudio={false}
          onClear={() => {}}
        />
      </AirportContext.Provider>,
    );
    expect(screen.getByText("Scheduled")).toBeInTheDocument(); // status pill from AeroAPI
    expect(screen.getAllByText(/Departs/).length).toBeGreaterThan(0); // headline + row
    expect(screen.getByText(/gate A84/)).toBeInTheDocument();
    expect(screen.getByText(/gate F · T3/)).toBeInTheDocument();
    expect(screen.getByText(/FlightAware/)).toBeInTheDocument();
    expect(screen.getAllByText("+10m").length).toBeGreaterThan(0); // 600 s departure delay
  });

  it("shows the flight number, aircraft type and airline as a status card", () => {
    renderCard(item(-800));
    expect(screen.getByText("UX81TY")).toBeInTheDocument(); // IATA flight number
    expect(screen.getByText("B738")).toBeInTheDocument(); // aircraft type (header)
    expect(screen.getByText(/Air Europa/)).toBeInTheDocument(); // airline
    expect(screen.getByText(/Boeing 737-800/)).toBeInTheDocument(); // type description
    expect(screen.getByText(/EC-LXV/)).toBeInTheDocument(); // registration
  });
});
