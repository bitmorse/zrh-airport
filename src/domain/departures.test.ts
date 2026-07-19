import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { ZRH } from "../data/airports";
import { destinationPoint } from "../lib/geo";
import { buildAirport } from "./airport";
import {
  detectDepartures,
  gsSnapshot,
  lingerDepartures,
  trackHolding,
  type DepartureEvent,
  type DepartureMemory,
} from "./departures";

const AP = buildAirport(ZRH);

function base(overrides: Partial<Aircraft>): Aircraft {
  return {
    hex: "dep1",
    flight: "SWR40L",
    lat: 0,
    lon: 0,
    altFt: null,
    onGround: false,
    gs: null,
    track: null,
    verticalRateFpm: null,
    seenPos: 0,
    type: null,
    typeDesc: null,
    registration: null,
    ...overrides,
  };
}

// Place an aircraft `distM` past the given end's threshold toward the far end.
function onRunway(endId: string, distM: number, overrides: Partial<Aircraft>): Aircraft {
  const end = AP.endById[endId];
  const pos = distM === 0 ? end.threshold : destinationPoint(end.threshold, end.bearingDeg, distM);
  return base({ lat: pos.lat, lon: pos.lon, track: end.bearingDeg, ...overrides });
}

describe("detectDepartures", () => {
  it("flags a stationary aircraft at the threshold as holding", () => {
    const ac = onRunway("32", 0, { onGround: true, gs: 0 });
    const d = detectDepartures(AP, [ac], new Map());
    expect(d).toHaveLength(1);
    expect(d[0].phase).toBe("holding");
    expect(d[0].end).toBe("32");
  });

  it("flags an accelerating aircraft on the runway as roll", () => {
    const ac = onRunway("32", 600, { onGround: true, gs: 70 });
    const d = detectDepartures(AP, [ac], new Map([["dep1", 40]])); // was 40, now 70 → accelerating
    expect(d).toHaveLength(1);
    expect(d[0].phase).toBe("roll");
    expect(d[0].end).toBe("32");
  });

  it("does NOT flag a decelerating aircraft (landing roll-out) as roll", () => {
    const ac = onRunway("28", 600, { onGround: true, gs: 70 });
    const d = detectDepartures(AP, [ac], new Map([["dep1", 110]])); // 110 → 70 = decelerating
    expect(d.filter((e) => e.phase === "roll")).toHaveLength(0);
  });

  it("waits for a speed trend before calling it a roll (first sighting)", () => {
    const ac = onRunway("32", 600, { onGround: true, gs: 70 });
    expect(detectDepartures(AP, [ac], new Map())).toHaveLength(0); // no prev gs yet
  });

  it("flags an airborne climbing aircraft as climb", () => {
    const ac = onRunway("32", 2500, {
      onGround: false,
      altFt: 2200,
      gs: 160,
      verticalRateFpm: 1800,
    });
    const d = detectDepartures(AP, [ac], new Map());
    expect(d).toHaveLength(1);
    expect(d[0].phase).toBe("climb");
  });

  it("gsSnapshot captures per-aircraft groundspeed", () => {
    const snap = gsSnapshot([base({ hex: "a", gs: 42 }), base({ hex: "b", gs: null })]);
    expect(snap.get("a")).toBe(42);
    expect(snap.has("b")).toBe(false);
  });
});

describe("trackHolding", () => {
  const dep = (phase: DepartureEvent["phase"], hex = "d1"): DepartureEvent => ({
    end: "32",
    strip: "14/32",
    hex,
    callsign: "SWR40L",
    phase,
    gsKt: 0,
  });

  it("stamps holding start, then reports the waited duration on roll", () => {
    const holdingSince = new Map<string, number>();
    const p1 = trackHolding([dep("holding")], new Set(["d1"]), holdingSince, 1000);
    expect(p1[0].holdingSinceMs).toBe(1000);

    // 90 s later the aircraft starts its roll.
    const p2 = trackHolding([dep("roll")], new Set(["d1"]), holdingSince, 91000);
    expect(p2[0].waitedMs).toBe(90000);
    expect(holdingSince.has("d1")).toBe(false); // cleared after roll
  });

  it("prunes aircraft that have left the feed", () => {
    const holdingSince = new Map<string, number>([["gone", 500]]);
    trackHolding([], new Set(["other"]), holdingSince, 2000);
    expect(holdingSince.has("gone")).toBe(false);
  });

  it("keeps counting from the first holding poll", () => {
    const holdingSince = new Map<string, number>();
    trackHolding([dep("holding")], new Set(["d1"]), holdingSince, 1000);
    const again = trackHolding([dep("holding")], new Set(["d1"]), holdingSince, 5000);
    expect(again[0].holdingSinceMs).toBe(1000); // unchanged start
  });
});

describe("lingerDepartures", () => {
  const dep = (hex: string, phase: DepartureEvent["phase"]): DepartureEvent => ({
    end: "28",
    strip: "10/28",
    hex,
    callsign: "SWR40L",
    phase,
    gsKt: 0,
  });

  it("coasts a departure across a brief gap, then drops it after the window", () => {
    const mem = new Map<string, DepartureMemory>();
    expect(lingerDepartures([dep("a", "holding")], mem, 1000, 45000).map((d) => d.hex)).toEqual([
      "a",
    ]);
    // A poll later the aircraft is missing from the feed — still shown.
    expect(lingerDepartures([], mem, 16000, 45000).map((d) => d.hex)).toEqual(["a"]);
    // Past the linger window — gone.
    expect(lingerDepartures([], mem, 60000, 45000)).toHaveLength(0);
    expect(mem.has("a")).toBe(false);
  });

  it("refreshes on reappearance and coasts the last-known phase", () => {
    const mem = new Map<string, DepartureMemory>();
    lingerDepartures([dep("a", "holding")], mem, 0, 45000);
    lingerDepartures([dep("a", "roll")], mem, 40000, 45000); // seen again, now rolling
    const out = lingerDepartures([], mem, 80000, 45000); // 40 s after last seen → still within
    expect(out.map((d) => d.hex)).toEqual(["a"]);
    expect(out[0].phase).toBe("roll");
  });
});
