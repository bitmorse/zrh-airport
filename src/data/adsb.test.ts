import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAircraftNear, minSeen, PROVIDER_NAMES } from "./adsb";
import type { Aircraft } from "./adsb";

const CENTER = { lat: 47.46, lon: 8.55 };

/** A raw ADS-B aircraft with a given `seen_pos` (omit the field when `seen` is null). */
function raw(seen: number | null) {
  const a: Record<string, unknown> = { hex: "abc123", lat: 47, lon: 8 };
  if (seen != null) a.seen_pos = seen;
  return a;
}

/** A normalised aircraft with a given seenPos (for the minSeen unit test). */
function ac(seenPos: number | null): Aircraft {
  return {
    hex: "x",
    flight: null,
    lat: 47,
    lon: 8,
    altFt: null,
    altGeomFt: null,
    onGround: false,
    gs: null,
    track: null,
    verticalRateFpm: null,
    seenPos,
    type: null,
    typeDesc: null,
    registration: null,
  };
}

type Resp = { ok?: boolean; status?: number; ac?: unknown[]; throws?: boolean };

/** Route each provider independently by matching its host in the request URL. */
function routeFetch(map: { lol?: Resp; fi?: Resp; live?: Resp }) {
  const fn = vi.fn(async (url: string) => {
    const key = url.includes("adsb.lol")
      ? "lol"
      : url.includes("adsb.fi")
        ? "fi"
        : "live";
    const r = map[key as keyof typeof map];
    if (!r || r.throws) throw new Error("network");
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => ({ ac: r.ac ?? [] }),
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("minSeen", () => {
  it("scores empty as Infinity, non-empty by freshest, no-signal as fresh", () => {
    expect(minSeen([])).toBe(Infinity);
    expect(minSeen([ac(5), ac(2)])).toBe(2);
    expect(minSeen([ac(null)])).toBe(0); // non-empty, no seen_pos → treat as fresh
    expect(minSeen([ac(null), ac(4)])).toBe(4);
  });
});

describe("fetchAircraftNear provider failover", () => {
  it("uses the first fresh provider and makes a single request", async () => {
    const fn = routeFetch({ lol: { ac: [raw(2)] } });
    const snap = await fetchAircraftNear(CENTER);
    expect(snap.provider).toBe("adsb.lol");
    expect(snap.aircraft).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fails over past an empty 200 to the next fresh provider", async () => {
    const fn = routeFetch({ lol: { ac: [] }, fi: { ac: [raw(3)] } });
    const snap = await fetchAircraftNear(CENTER);
    expect(snap.provider).toBe("adsb.fi");
    expect(snap.aircraft).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][0]).toContain("adsb.lol");
    expect(fn.mock.calls[1][0]).toContain("adsb.fi");
  });

  it("fails over past a stale 200 (freshest aircraft too old)", async () => {
    const fn = routeFetch({ lol: { ac: [raw(90), raw(120)] }, fi: { ac: [raw(5)] } });
    const snap = await fetchAircraftNear(CENTER);
    expect(snap.provider).toBe("adsb.fi");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns the freshest stale snapshot (flagged) when none is fresh", async () => {
    routeFetch({ lol: { ac: [raw(90)] }, fi: { ac: [raw(70)] }, live: { ac: [raw(200)] } });
    const snap = await fetchAircraftNear(CENTER);
    expect(snap.provider).toBe("adsb.fi"); // min seen 70 is freshest of the stale
    expect(snap.stale).toBe(true);
  });

  it("returns an empty snapshot (no throw) when every provider is empty", async () => {
    routeFetch({ lol: { ac: [] }, fi: { ac: [] }, live: { ac: [] } });
    const snap = await fetchAircraftNear(CENTER);
    expect(snap.aircraft).toHaveLength(0);
    expect(snap.provider).toBe("adsb.lol"); // first candidate
    expect(snap.stale).toBeUndefined(); // empty isn't flagged "stale"
  });

  it("throws only when every provider hard-fails", async () => {
    routeFetch({
      lol: { ok: false, status: 500 },
      fi: { ok: false, status: 500 },
      live: { ok: false, status: 500 },
    });
    await expect(fetchAircraftNear(CENTER)).rejects.toThrow(/All ADS-B providers failed/);
  });

  it("still fails over on a non-2xx response", async () => {
    const fn = routeFetch({ lol: { ok: false, status: 502 }, fi: { ac: [raw(4)] } });
    const snap = await fetchAircraftNear(CENTER);
    expect(snap.provider).toBe("adsb.fi");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("honours a preferred provider, then falls back when it is stale", async () => {
    const fn = routeFetch({ live: { ac: [raw(90)] }, lol: { ac: [raw(2)] } });
    const snap = await fetchAircraftNear(CENTER, 25, "airplanes.live");
    expect(fn.mock.calls[0][0]).toContain("airplanes.live"); // preferred tried first
    expect(snap.provider).toBe("adsb.lol"); // preferred was stale → fell back to fresh
  });

  it("treats a non-empty feed with no seen_pos as fresh", async () => {
    const fn = routeFetch({ lol: { ac: [{ hex: "z", lat: 47, lon: 8 }] } });
    const snap = await fetchAircraftNear(CENTER);
    expect(snap.provider).toBe("adsb.lol");
    expect(snap.aircraft).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exposes the provider names for the settings UI", () => {
    expect(PROVIDER_NAMES).toContain("adsb.lol");
  });
});
