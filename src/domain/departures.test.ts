import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { destinationPoint } from "../lib/geo";
import { RUNWAY_END_BY_ID } from "./runways";
import { detectDepartures, gsSnapshot } from "./departures";

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
    ...overrides,
  };
}

// Place an aircraft `distM` past the given end's threshold toward the far end.
function onRunway(endId: string, distM: number, overrides: Partial<Aircraft>): Aircraft {
  const end = RUNWAY_END_BY_ID[endId];
  const pos = distM === 0 ? end.threshold : destinationPoint(end.threshold, end.bearingDeg, distM);
  return base({ lat: pos.lat, lon: pos.lon, track: end.bearingDeg, ...overrides });
}

describe("detectDepartures", () => {
  it("flags a stationary aircraft at the threshold as holding", () => {
    const ac = onRunway("32", 0, { onGround: true, gs: 0 });
    const d = detectDepartures([ac], new Map());
    expect(d).toHaveLength(1);
    expect(d[0].phase).toBe("holding");
    expect(d[0].end).toBe("32");
  });

  it("flags an accelerating aircraft on the runway as roll", () => {
    const ac = onRunway("32", 600, { onGround: true, gs: 70 });
    const d = detectDepartures([ac], new Map([["dep1", 40]])); // was 40, now 70 → accelerating
    expect(d).toHaveLength(1);
    expect(d[0].phase).toBe("roll");
    expect(d[0].end).toBe("32");
  });

  it("does NOT flag a decelerating aircraft (landing roll-out) as roll", () => {
    const ac = onRunway("28", 600, { onGround: true, gs: 70 });
    const d = detectDepartures([ac], new Map([["dep1", 110]])); // 110 → 70 = decelerating
    expect(d.filter((e) => e.phase === "roll")).toHaveLength(0);
  });

  it("waits for a speed trend before calling it a roll (first sighting)", () => {
    const ac = onRunway("32", 600, { onGround: true, gs: 70 });
    expect(detectDepartures([ac], new Map())).toHaveLength(0); // no prev gs yet
  });

  it("flags an airborne climbing aircraft as climb", () => {
    const ac = onRunway("32", 2500, {
      onGround: false,
      altFt: 2200,
      gs: 160,
      verticalRateFpm: 1800,
    });
    const d = detectDepartures([ac], new Map());
    expect(d).toHaveLength(1);
    expect(d[0].phase).toBe("climb");
  });

  it("gsSnapshot captures per-aircraft groundspeed", () => {
    const snap = gsSnapshot([base({ hex: "a", gs: 42 }), base({ hex: "b", gs: null })]);
    expect(snap.get("a")).toBe(42);
    expect(snap.has("b")).toBe(false);
  });
});
