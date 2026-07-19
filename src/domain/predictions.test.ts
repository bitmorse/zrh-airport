import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { assignRunway } from "./assignRunway";
import { RUNWAY_END_BY_ID } from "./runways";
import { destinationPoint } from "../lib/geo";
import { departingNow, nextArrivalByStrip, predictArrivals } from "./predictions";

function onApproach(
  endId: string,
  finalDistanceM: number,
  gs: number | null,
  hex = "abc123",
): { ac: Aircraft; assignment: ReturnType<typeof assignRunway> } {
  const end = RUNWAY_END_BY_ID[endId];
  const reverse = (end.bearingDeg + 180) % 360;
  const pos = destinationPoint(end.threshold, reverse, finalDistanceM);
  const ac: Aircraft = {
    hex,
    flight: "SWR1",
    lat: pos.lat,
    lon: pos.lon,
    altFt: 2500,
    onGround: false,
    gs,
    track: end.bearingDeg,
    seenPos: 1,
  };
  return { ac, assignment: assignRunway(ac) };
}

describe("predictArrivals", () => {
  it("estimates ETA from distance and groundspeed", () => {
    // 3 km final at 140 kt → 3000 / (140 * 0.514444) ≈ 41.6 s.
    const arrivals = predictArrivals([onApproach("28", 3000, 140)]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].end).toBe("28");
    expect(arrivals[0].strip).toBe("10/28");
    expect(arrivals[0].etaSeconds).toBeCloseTo(41.6, 0);
    expect(arrivals[0].distanceNm).toBeCloseTo(1.62, 1);
  });

  it("sorts soonest-first", () => {
    const arrivals = predictArrivals([
      onApproach("28", 6000, 140, "far"),
      onApproach("16", 2000, 140, "near"),
    ]);
    expect(arrivals.map((a) => a.hex)).toEqual(["near", "far"]);
  });

  it("excludes aircraft too slow to estimate", () => {
    expect(predictArrivals([onApproach("28", 3000, 10)])).toHaveLength(0);
    expect(predictArrivals([onApproach("28", 3000, null)])).toHaveLength(0);
  });
});

describe("nextArrivalByStrip", () => {
  it("keeps the soonest arrival per strip", () => {
    const byStrip = nextArrivalByStrip([
      onApproach("28", 5000, 140, "later"),
      onApproach("10", 1500, 140, "sooner"),
    ]);
    // Both ends are the same 10/28 strip; the nearer one wins.
    expect(byStrip["10/28"].hex).toBe("sooner");
    expect(byStrip["10/28"].end).toBe("10");
  });
});

describe("departingNow", () => {
  it("lists aircraft climbing out, not arrivals", () => {
    const end = RUNWAY_END_BY_ID["16"];
    // Just past the far end, climbing on runway heading → phase "departure".
    const pos = destinationPoint(end.farEnd, end.bearingDeg, 2000);
    const departing: Aircraft = {
      hex: "dep1",
      flight: "DLH9",
      lat: pos.lat,
      lon: pos.lon,
      altFt: 2200,
      onGround: false,
      gs: 180,
      track: end.bearingDeg,
      seenPos: 1,
    };
    const items = [
      { ac: departing, assignment: assignRunway(departing) },
      onApproach("28", 3000, 140),
    ];
    const deps = departingNow(items);
    expect(deps).toHaveLength(1);
    expect(deps[0].hex).toBe("dep1");
  });
});
