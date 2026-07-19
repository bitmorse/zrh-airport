import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { assignRunway } from "./assignRunway";
import { ZRH } from "../data/airports";
import { buildAirport } from "./airport";
import { destinationPoint } from "../lib/geo";
import {
  nextArrivalByStrip,
  predictArrivals,
  trackDecisionHeight,
  trackLandings,
  type Arrival,
} from "./predictions";

const AP = buildAirport(ZRH);

interface Opts {
  gs?: number | null;
  hex?: string;
  vr?: number | null; // vertical rate ft/min
  onGround?: boolean;
}

function onApproach(endId: string, finalDistanceM: number, opts: Opts = {}) {
  const { gs = 140, hex = "abc123", vr = -700, onGround = false } = opts;
  const end = AP.endById[endId];
  const reverse = (end.bearingDeg + 180) % 360;
  const pos = destinationPoint(end.threshold, reverse, finalDistanceM);
  const ac: Aircraft = {
    hex,
    flight: "SWR1",
    lat: pos.lat,
    lon: pos.lon,
    altFt: 2500,
    altGeomFt: null,
    onGround,
    gs,
    track: end.bearingDeg,
    verticalRateFpm: vr,
    seenPos: 1,
    type: null,
    typeDesc: null,
    registration: null,
  };
  return { ac, assignment: assignRunway(AP, ac) };
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

function inbound(
  hex: string,
  aglFt: number,
  phase: "approach" | "departure" = "approach",
): AircraftWithAssignment {
  return {
    ac: {
      hex,
      flight: null,
      lat: 0,
      lon: 0,
      altFt: aglFt, // field elevation 0 in these tests, so altFt == AGL
      altGeomFt: null,
      onGround: false,
      gs: 140,
      track: 280,
      verticalRateFpm: -700,
      seenPos: 1,
      type: null,
      typeDesc: null,
      registration: null,
    },
    assignment: { end: "28", strip: "10/28", phase, crossTrackM: 0, alongTrackM: -800 },
  };
}

describe("trackDecisionHeight", () => {
  it("stamps the crossing through decision height exactly once", () => {
    const cr = new Map<string, number>();
    trackDecisionHeight([inbound("a", 300)], cr, 0, 5000); // above DH — nothing
    expect(cr.has("a")).toBe(false);
    trackDecisionHeight([inbound("a", 150)], cr, 0, 9000); // descends through ≤200
    expect(cr.get("a")).toBe(9000);
    trackDecisionHeight([inbound("a", 80)], cr, 0, 12000); // lower still — unchanged
    expect(cr.get("a")).toBe(9000);
  });

  it("ignores a departure climbing through the same altitude", () => {
    const cr = new Map<string, number>();
    trackDecisionHeight([inbound("b", 150, "departure")], cr, 0, 1000);
    expect(cr.has("b")).toBe(false);
  });

  it("prunes an aircraft once it leaves the feed", () => {
    const cr = new Map<string, number>([["a", 9000]]);
    trackDecisionHeight([], cr, 0, 20000);
    expect(cr.has("a")).toBe(false);
  });
});

describe("trackLandings", () => {
  const arr = (hex: string): Arrival => ({
    end: "28",
    strip: "10/28",
    hex,
    callsign: "SWR1",
    etaSeconds: 8,
    distanceNm: 0.3,
    gsKt: 130,
  });

  function onRunway(hex: string, gs: number, onGround = true): AircraftWithAssignment {
    return {
      ac: {
        hex,
        flight: "SWR1",
        lat: 0,
        lon: 0,
        altFt: onGround ? null : 50,
        altGeomFt: null,
        onGround,
        gs,
        track: 280,
        verticalRateFpm: onGround ? null : -100,
        seenPos: 1,
        type: null,
        typeDesc: null,
        registration: null,
      },
      assignment: { end: "28", strip: "10/28", phase: "runway", crossTrackM: 0, alongTrackM: 200 },
    };
  }

  it("keeps a touched-down aircraft as a landing until it slows below ~100 km/h", () => {
    const mem = new Map();
    // On final — a real arrival.
    expect(trackLandings([arr("a")], [], mem, 1000).map((x) => x.hex)).toEqual(["a"]);
    // Crossed the threshold: no longer a fresh arrival, but rolling fast → kept as landing.
    const rollout = trackLandings([], [onRunway("a", 90)], mem, 5000);
    expect(rollout).toHaveLength(1);
    expect(rollout[0].etaSeconds).toBe(0); // shows "landing"
    // Slowed to a taxi → dropped.
    expect(trackLandings([], [onRunway("a", 30)], mem, 9000)).toHaveLength(0);
  });

  it("drops a go-around (climbing away) rather than calling it a landing", () => {
    const mem = new Map();
    trackLandings([arr("b")], [], mem, 1000);
    const ga: AircraftWithAssignment = {
      ac: { ...onRunway("b", 140, false).ac, verticalRateFpm: 1800 },
      assignment: { end: "28", strip: "10/28", phase: "runway", crossTrackM: 0, alongTrackM: 100 },
    };
    expect(trackLandings([], [ga], mem, 5000)).toHaveLength(0);
  });
});
