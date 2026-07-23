import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightLookupError, fetchFlightLookup, fetchFlightPosition } from "./flightLookup";

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchFlightLookup", () => {
  it("parses a 200 defensively (missing fields → null, booleans default false)", async () => {
    mockFetch(200, {
      faFlightId: "SWR72-1",
      ident: "SWR72",
      identIata: "LX72",
      status: "Scheduled",
      gateOrigin: "B27",
      origin: { icao: "LSZH", iata: "ZRH", name: "Zurich", city: "Zurich" },
      departureDelay: 600,
    });
    const r = await fetchFlightLookup("SWR72");
    expect(r?.faFlightId).toBe("SWR72-1");
    expect(r?.identIata).toBe("LX72");
    expect(r?.origin?.iata).toBe("ZRH");
    expect(r?.departureDelay).toBe(600);
    expect(r?.registration).toBeNull(); // absent → null
    expect(r?.cancelled).toBe(false); // absent boolean → false
  });

  it("returns null for an invalid ident without calling the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await fetchFlightLookup("!!")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null (silent fallback) for 404 / 501", async () => {
    mockFetch(404, { error: "flight not found" });
    expect(await fetchFlightLookup("SWR72")).toBeNull();
    mockFetch(501, { error: "flight lookup not configured" });
    expect(await fetchFlightLookup("SWR72")).toBeNull();
  });

  it("throws a typed error for the daily cap (429) and a provider fault (502)", async () => {
    mockFetch(429, { error: "daily flight-lookup limit reached" });
    await expect(fetchFlightLookup("SWR72")).rejects.toMatchObject({ code: "rate-limited", status: 429 });
    mockFetch(502, { error: "flight provider unavailable" });
    await expect(fetchFlightLookup("SWR72")).rejects.toBeInstanceOf(FlightLookupError);
  });
});

describe("fetchFlightPosition", () => {
  it("parses a fix (200)", async () => {
    mockFetch(200, { faFlightId: "SWR72-1", lat: 47.46, lon: 8.55, altitude: 20, updateType: "A" });
    const p = await fetchFlightPosition("SWR72-1");
    expect(p?.lat).toBeCloseTo(47.46);
    expect(p?.altitude).toBe(20); // raw hundreds-of-feet; the hook does ×100
  });

  it("returns identity with null coordinates for a parked jet (still 200)", async () => {
    mockFetch(200, { faFlightId: "SWR72-1", ident: "SWR72", lat: null, lon: null });
    const p = await fetchFlightPosition("SWR72-1");
    expect(p?.ident).toBe("SWR72");
    expect(p?.lat).toBeNull();
  });
});
