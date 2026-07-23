import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "./adsb";
import { classifyQuery, fetchTrackedAircraft, normalizeQuery } from "./flightQuery";

const lookup = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => vi.fn());
vi.mock("./adsb", () => ({ fetchAircraftByLookup: lookup }));
vi.mock("./flightInfo", () => ({ fetchFlightRoute: route }));

const ac = (flight: string, hex = "abc123"): Aircraft =>
  ({ hex, flight, lat: 47, lon: 8 }) as Aircraft;

beforeEach(() => {
  lookup.mockReset();
  route.mockReset();
});

describe("classifyQuery / normalizeQuery", () => {
  it("classifies hex, registration and flight number", () => {
    expect(classifyQuery("4b1620")).toBe("hex");
    expect(classifyQuery("AI 136")).toBe("flight");
    expect(classifyQuery("AIC136")).toBe("flight");
    expect(classifyQuery("LX40")).toBe("flight");
    expect(classifyQuery("HB-JCA")).toBe("reg");
    expect(classifyQuery("D-AIMA")).toBe("reg");
    expect(classifyQuery("N123AB")).toBe("reg");
  });
  it("normalizes away spaces and dashes", () => {
    expect(normalizeQuery("ai 136")).toBe("AI136");
    expect(normalizeQuery("hb-jca")).toBe("HBJCA");
  });
});

describe("fetchTrackedAircraft", () => {
  it("looks up a hex directly", async () => {
    lookup.mockResolvedValueOnce([ac("EDW894T", "4b1620")]);
    const r = await fetchTrackedAircraft("4b1620");
    expect(lookup).toHaveBeenCalledWith("hex", "4B1620", undefined);
    expect(r?.aircraft.hex).toBe("4b1620");
  });

  it("resolves an IATA flight number to the ICAO callsign via adsbdb, then matches", async () => {
    route.mockResolvedValueOnce({ airlineIcao: "AIC", airlineIata: "AI" });
    lookup.mockResolvedValueOnce([ac("AIC136")]); // provider callsign feed
    const r = await fetchTrackedAircraft("AI 136");
    expect(route).toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith("callsign", "AIC136", undefined);
    expect(r?.callsign).toBe("AIC136");
  });

  it("falls back to the raw query when adsbdb has no route", async () => {
    route.mockResolvedValueOnce(null);
    lookup.mockResolvedValueOnce([ac("LX40")]);
    const r = await fetchTrackedAircraft("LX40");
    expect(lookup).toHaveBeenCalledWith("callsign", "LX40", undefined);
    expect(r?.aircraft.flight).toBe("LX40");
  });

  it("returns null when the flight isn't broadcasting", async () => {
    route.mockResolvedValueOnce({ airlineIcao: "AIC" });
    lookup.mockResolvedValue([]); // both candidate callsigns empty
    expect(await fetchTrackedAircraft("AI136")).toBeNull();
  });

  it("looks up a registration", async () => {
    lookup.mockResolvedValueOnce([ac("SWR123", "4b19f5")]);
    const r = await fetchTrackedAircraft("HB-JCA");
    expect(lookup).toHaveBeenCalledWith("reg", "HBJCA", undefined);
    expect(r?.aircraft.hex).toBe("4b19f5");
  });
});
