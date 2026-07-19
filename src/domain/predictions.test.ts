import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { assignRunway } from "./assignRunway";
import { RUNWAY_END_BY_ID } from "./runways";
import { destinationPoint } from "../lib/geo";
import { nextArrivalByStrip, predictArrivals } from "./predictions";

interface Opts {
  gs?: number | null;
  hex?: string;
  vr?: number | null; // vertical rate ft/min
  onGround?: boolean;
}

function onApproach(endId: string, finalDistanceM: number, opts: Opts = {}) {
  const { gs = 140, hex = "abc123", vr = -700, onGround = false } = opts;
  const end = RUNWAY_END_BY_ID[endId];
  const reverse = (end.bearingDeg + 180) % 360;
  const pos = destinationPoint(end.threshold, reverse, finalDistanceM);
  const ac: Aircraft = {
    hex,
    flight: "SWR1",
    lat: pos.lat,
    lon: pos.lon,
    altFt: 2500,
    onGround,
    gs,
    track: end.bearingDeg,
    verticalRateFpm: vr,
    seenPos: 1,
  };
  return { ac, assignment: assignRunway(ac) };
}

describe("predictArrivals", () => {
  it("estimates ETA from distance and groundspeed", () => {
    // 3 km final at 140 kt → 3000 / (140 * 0.514444) ≈ 41.6 s.
    const arrivals = predictArrivals([onApproach("28", 3000)]);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].end).toBe("28");
    expect(arrivals[0].strip).toBe("10/28");
    expect(arrivals[0].etaSeconds).toBeCloseTo(41.6, 0);
    expect(arrivals[0].distanceNm).toBeCloseTo(1.62, 1);
  });

  it("detects a long (12 NM) final", () => {
    const arr = predictArrivals([onApproach("28", 22224)]); // 12 NM
    expect(arr).toHaveLength(1);
    expect(arr[0].distanceNm).toBeCloseTo(12, 0);
  });

  it("sorts soonest-first", () => {
    const arrivals = predictArrivals([
      onApproach("28", 6000, { hex: "far" }),
      onApproach("16", 2000, { hex: "near" }),
    ]);
    expect(arrivals.map((a) => a.hex)).toEqual(["near", "far"]);
  });

  it("excludes aircraft too slow to estimate", () => {
    expect(predictArrivals([onApproach("28", 3000, { gs: 10 })])).toHaveLength(0);
    expect(predictArrivals([onApproach("28", 3000, { gs: null })])).toHaveLength(0);
  });

  it("excludes climbing aircraft (go-around / overflight)", () => {
    expect(predictArrivals([onApproach("28", 3000, { vr: 1800 })])).toHaveLength(0);
  });

  it("excludes on-ground aircraft (taxiing, not landing)", () => {
    expect(
      predictArrivals([onApproach("28", 3000, { onGround: true })]),
    ).toHaveLength(0);
  });

  it("still counts a level aircraft on final", () => {
    expect(predictArrivals([onApproach("28", 3000, { vr: 0 })])).toHaveLength(1);
  });
});

describe("nextArrivalByStrip", () => {
  it("keeps the soonest arrival per strip", () => {
    const byStrip = nextArrivalByStrip([
      onApproach("28", 5000, { hex: "later" }),
      onApproach("10", 1500, { hex: "sooner" }),
    ]);
    expect(byStrip["10/28"].hex).toBe("sooner");
    expect(byStrip["10/28"].end).toBe("10");
  });
});
