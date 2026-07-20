import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAirportMovements } from "./airportStats";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAirportMovements", () => {
  it("maps the API response into runway histograms + totals, padding hours to 24", () => {
    mockFetchOnce(200, {
      icao: "LSZH",
      ends: [
        {
          end: "14",
          landings: 128,
          takeoffs: 4,
          days: 6,
          hours: [{ hour: 14, landings: 22, takeoffs: 1, days: 5 }],
        },
      ],
      totals: { landings: 140, takeoffs: 100, days: 6 },
      windowDays: 60,
      generatedAt: 1784544186140,
    });

    return fetchAirportMovements("lszh").then((r) => {
      expect(r.summary).toEqual({ landings: 140, takeoffs: 100, days: 6 });
      expect(r.windowDays).toBe(60);
      expect(r.runways).toHaveLength(1);
      const rw = r.runways[0];
      expect(rw.end).toBe("14");
      expect(rw.hours).toHaveLength(24); // padded
      expect(rw.hours[14]).toEqual({ hour: 14, landings: 22, takeoffs: 1, days: 5 });
      expect(rw.hours[0]).toEqual({ hour: 0, landings: 0, takeoffs: 0, days: 0 });
    });
  });

  it("handles an empty airport (200 with no ends)", () => {
    mockFetchOnce(200, { icao: "LSZH", ends: [], totals: { landings: 0, takeoffs: 0, days: 0 } });
    return fetchAirportMovements("LSZH").then((r) => {
      expect(r.runways).toEqual([]);
      expect(r.summary).toEqual({ landings: 0, takeoffs: 0, days: 0 });
    });
  });

  it("throws on a non-2xx response", async () => {
    mockFetchOnce(404, { error: "unknown airport" });
    await expect(fetchAirportMovements("ZZZZ")).rejects.toThrow(/404/);
  });
});
