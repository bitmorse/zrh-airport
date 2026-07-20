import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { ZRH } from "../data/airports";
import { destinationPoint } from "../lib/geo";
import { buildAirport } from "./airport";
import {
  detectDepartures,
  gsSnapshot,
  trackDepartures,
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
    altGeomFt: null,
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

  it("waits for a trend or a holding history before roll (first sighting, cold)", () => {
    const ac = onRunway("32", 600, { onGround: true, gs: 70 });
    // No prev gs AND no holding history → can't yet tell takeoff from landing.
    expect(detectDepartures(AP, [ac], new Map())).toHaveLength(0);
  });

  it("flags a just-held aircraft that starts moving as roll (no prev gs)", () => {
    const ac = onRunway("32", 400, { onGround: true, gs: 30 });
    // It was holding last poll; now moving → roll, even with no prior groundspeed.
    const d = detectDepartures(AP, [ac], new Map(), new Set(["dep1"]));
    expect(d).toHaveLength(1);
    expect(d[0].phase).toBe("roll");
  });

  it("keeps a just-held roll through a flat/down jitter poll", () => {
    const ac = onRunway("32", 400, { onGround: true, gs: 30 });
    // Groundspeed ticked down (30 < 32) — the accel trend breaks, but holding history holds.
    const d = detectDepartures(AP, [ac], new Map([["dep1", 32]]), new Set(["dep1"]));
    expect(d[0]?.phase).toBe("roll");
  });

  it("catches the early roll in the old 12–25 kt dead zone", () => {
    const ac = onRunway("32", 200, { onGround: true, gs: 18 });
    // Via holding history:
    expect(
      detectDepartures(AP, [ac], new Map(), new Set(["dep1"]))[0]?.phase,
    ).toBe("roll");
    // Via a fresh accel trend (13 → 18), no history:
    expect(
      detectDepartures(AP, [ac], new Map([["dep1", 13]]))[0]?.phase,
    ).toBe("roll");
  });

  it("does NOT flag a slow decelerating landing roll-out (no holding history)", () => {
    const ac = onRunway("28", 600, { onGround: true, gs: 18 });
    const d = detectDepartures(AP, [ac], new Map([["dep1", 70]])); // 70 → 18, never held
    expect(d.filter((e) => e.phase === "roll")).toHaveLength(0);
  });

  it("does NOT flag a held aircraft turning off the runway (misaligned) as roll", () => {
    const bearing = AP.endById["32"].bearingDeg;
    const ac = onRunway("32", 200, { onGround: true, gs: 20, track: bearing + 90 });
    // Held, now moving, but 90° off the runway heading → taxiing off, not a roll.
    const d = detectDepartures(AP, [ac], new Map(), new Set(["dep1"]));
    expect(d.filter((e) => e.phase === "roll")).toHaveLength(0);
  });

  it("flags an airborne climbing aircraft as climb", () => {
    const ac = onRunway("32", 2500, {
      onGround: false,
      altFt: 2200,
      altGeomFt: null,
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

describe("holding → roll promotion (end-to-end)", () => {
  it("promotes a held aircraft to roll on first movement and reports the wait", () => {
    const holdingSince = new Map<string, number>();

    // Poll 1: stationary at the threshold → holding, wait timer starts at t=1000.
    const held = onRunway("32", 0, { onGround: true, gs: 0 });
    const p1 = trackHolding(
      detectDepartures(AP, [held], new Map()),
      new Set(["dep1"]),
      holdingSince,
      1000,
    );
    expect(p1[0].phase).toBe("holding");
    expect(holdingSince.get("dep1")).toBe(1000);

    // Poll 2, 30 s later: moving, no prior groundspeed sample — the holding history
    // (holdingSince keys from poll 1) still promotes it to roll, and the wait is reported.
    const moving = onRunway("32", 400, { onGround: true, gs: 30 });
    const p2 = trackHolding(
      detectDepartures(AP, [moving], new Map(), new Set(holdingSince.keys())),
      new Set(["dep1"]),
      holdingSince,
      31000,
    );
    expect(p2[0].phase).toBe("roll");
    expect(p2[0].waitedMs).toBe(30000);
    expect(holdingSince.has("dep1")).toBe(false); // cleared once rolling
  });
});

describe("trackDepartures", () => {
  const dep = (hex: string, phase: DepartureEvent["phase"]): DepartureEvent => ({
    end: "28",
    strip: "10/28",
    hex,
    callsign: "SWR40L",
    phase,
    gsKt: 0,
  });
  const ac = (over: Partial<Aircraft>): Aircraft =>
    base({ hex: "a", onGround: true, ...over });

  it("keeps the row through the roll→climb gap and until it passes 1000 ft AGL", () => {
    const mem = new Map<string, DepartureMemory>();
    // Rolling on the ground — detected.
    expect(
      trackDepartures([dep("a", "roll")], [ac({ onGround: true })], mem, 0, 1000).map((d) => d.hex),
    ).toEqual(["a"]);

    // Rotation gap: airborne, low, no phase detected — coasted as climb, not dropped.
    const gap = trackDepartures([], [ac({ onGround: false, altFt: 400 })], mem, 0, 2000);
    expect(gap.map((d) => d.hex)).toEqual(["a"]);
    expect(gap[0].phase).toBe("climb");

    // Climbs past 1000 ft AGL — the departure is complete, row drops.
    expect(trackDepartures([], [ac({ onGround: false, altFt: 1200 })], mem, 0, 3000)).toHaveLength(0);
    expect(mem.has("a")).toBe(false);
  });

  it("coasts an on-ground gap only for the linger window", () => {
    const mem = new Map<string, DepartureMemory>();
    trackDepartures([dep("a", "roll")], [ac({ onGround: true })], mem, 0, 1000, 45000);
    // Still on the ground and missing from detection → coasted while within window.
    expect(
      trackDepartures([], [ac({ onGround: true })], mem, 0, 16000, 45000).map((d) => d.hex),
    ).toEqual(["a"]);
    // Beyond the window (e.g. a rejected takeoff that just sits there) → dropped.
    expect(trackDepartures([], [ac({ onGround: true })], mem, 0, 60000, 45000)).toHaveLength(0);
  });

  it("coasts briefly when the aircraft falls off the feed entirely", () => {
    const mem = new Map<string, DepartureMemory>();
    trackDepartures([dep("a", "holding")], [ac({ onGround: true })], mem, 0, 1000);
    expect(trackDepartures([], [], mem, 0, 20000).map((d) => d.hex)).toEqual(["a"]);
    expect(trackDepartures([], [], mem, 0, 60000)).toHaveLength(0);
  });
});
