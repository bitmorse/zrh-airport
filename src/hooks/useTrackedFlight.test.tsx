import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../data/adsb";
import type { FlightRoute } from "../data/flightInfo";

const fetchTracked = vi.hoisted(() => vi.fn());
const fetchLookup = vi.hoisted(() => vi.fn());
const fetchPosition = vi.hoisted(() => vi.fn());
const routeState = vi.hoisted(() => ({ data: null as FlightRoute | null }));
vi.mock("../data/flightQuery", () => ({
  fetchTrackedAircraft: fetchTracked,
  normalizeQuery: (s: string) => s.trim().toUpperCase().replace(/[\s-]/g, ""),
  classifyQuery: (s: string) => (/^[a-z]{2,3}\s?\d{1,4}[a-z]?$/i.test(s.trim()) ? "flight" : "reg"),
}));
vi.mock("../data/flightLookup", () => ({
  fetchFlightLookup: fetchLookup,
  fetchFlightPosition: fetchPosition,
}));
vi.mock("./useFlightRoute", () => ({ useFlightRoute: () => routeState }));

import { useTrackedFlight } from "./useTrackedFlight";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const live: Aircraft = { hex: "4b1620", flight: "SWR40", lat: 47, lon: 8, onGround: false } as Aircraft;

const route: FlightRoute = {
  callsign: "SWR40",
  flightIata: "LX40",
  airlineName: "Swiss",
  airlineIata: "LX",
  airlineIcao: "SWR",
  origin: { iata: "GVA", icao: "LSGG", name: "Geneva", municipality: "Geneva", countryIso: "CH", lat: 46.23, lon: 6.11 },
  destination: { iata: "JFK", icao: "KJFK", name: "JFK", municipality: "New York", countryIso: "US", lat: 40.6, lon: -73.8 },
};

beforeEach(() => {
  fetchTracked.mockReset();
  fetchLookup.mockReset().mockResolvedValue(null); // no AeroAPI by default
  fetchPosition.mockReset().mockResolvedValue(null);
  routeState.data = null;
});

describe("useTrackedFlight", () => {
  it("reports a live fix when the flight is broadcasting", async () => {
    fetchTracked.mockResolvedValue({ aircraft: live, callsign: "SWR40" });
    routeState.data = route;
    const { result } = renderHook(() => useTrackedFlight("SWR40"), { wrapper });
    await waitFor(() => expect(result.current.positionSource).toBe("live"));
    expect(result.current.aircraft?.hex).toBe("4b1620");
  });

  it("falls back to a best guess at the route origin when it isn't broadcasting", async () => {
    fetchTracked.mockResolvedValue(null); // not on the feed
    routeState.data = route; // but adsbdb knows the route
    const { result } = renderHook(() => useTrackedFlight("LX40"), { wrapper });
    await waitFor(() => expect(result.current.positionSource).toBe("origin"));
    // Parked at the origin airport, marked as a synthetic (non-hex) id, on the ground.
    expect(result.current.aircraft?.lat).toBeCloseTo(46.23);
    expect(result.current.aircraft?.lon).toBeCloseTo(6.11);
    expect(result.current.aircraft?.onGround).toBe(true);
    expect(result.current.aircraft?.hex.startsWith("est-")).toBe(true);
  });

  it("pins an off-radar flight from the paid AeroAPI position when ADS-B has nothing", async () => {
    fetchTracked.mockResolvedValue(null); // not on our ADS-B radar
    routeState.data = route;
    fetchLookup.mockResolvedValue({ faFlightId: "SWR40-123", status: "Taxiing" });
    fetchPosition.mockResolvedValue({
      faFlightId: "SWR40-123",
      ident: "SWR40",
      lat: 47.46,
      lon: 8.55,
      altitude: 3, // hundreds of feet → 300 ft
      groundspeed: 15,
      heading: 120,
      updateType: "X",
    });
    const { result } = renderHook(() => useTrackedFlight("LX40"), { wrapper });
    await waitFor(() => expect(result.current.positionSource).toBe("lookup"));
    expect(result.current.aircraft?.lat).toBeCloseTo(47.46);
    expect(result.current.aircraft?.altFt).toBe(300); // ×100 unit conversion
    expect(result.current.lookup?.status).toBe("Taxiing");
  });

  it("stays empty while searching with no route to guess from", async () => {
    fetchTracked.mockResolvedValue(null);
    routeState.data = null;
    const { result } = renderHook(() => useTrackedFlight("ZZZ999"), { wrapper });
    await waitFor(() => expect(fetchTracked).toHaveBeenCalled());
    expect(result.current.aircraft).toBeNull();
    expect(result.current.positionSource).toBeNull();
  });
});
