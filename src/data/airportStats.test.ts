import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAirportMovements,
  fetchAirportRecent,
  recentCountsByEnd,
} from "./airportStats";

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn(async (url: string) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchAirportRecent", () => {
  it("parses the recent per-end shape and folds it to a counts map", async () => {
    mockFetchOnce(200, {
      ends: [
        { end: "28", movements: 12, landings: 9, takeoffs: 3 },
        { end: "16", movements: 4, landings: 0, takeoffs: 4 },
      ],
      minutes: 90,
      generatedAt: 1,
    });
    const r = await fetchAirportRecent("lszh", 90);
    expect(r.ends).toHaveLength(2);
    expect(r.minutes).toBe(90);
    expect(recentCountsByEnd(r)).toEqual({ "28": 12, "16": 4 });
  });

  it("throws on a non-2xx response", async () => {
    mockFetchOnce(503, { error: "down" });
    await expect(fetchAirportRecent("LSZH")).rejects.toThrow(/503/);
  });
});

describe("fetchAirportMovements dow", () => {
  it("appends the dow query param only when provided", async () => {
    const fn = mockFetchOnce(200, { ends: [], totals: {}, windowDays: 60 });
    await fetchAirportMovements("LSZH", 60, undefined, 5);
    expect(fn.mock.calls[0][0]).toContain("dow=5");

    fn.mockClear();
    await fetchAirportMovements("LSZH", 60);
    expect(fn.mock.calls[0][0]).not.toContain("dow=");
  });
});

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
