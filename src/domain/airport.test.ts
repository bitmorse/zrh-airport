import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { BKK, ZRH } from "../data/airports";
import { angleDelta, destinationPoint } from "../lib/geo";
import { buildAirport, type Airport } from "./airport";
import { assignRunway } from "./assignRunway";
import { predictArrivals } from "./predictions";
import { projectToSvg, SVG_H, SVG_W } from "../lib/projection";

describe("buildAirport", () => {
  it("derives ZRH's six runway ends with correct true headings", () => {
    const ap = buildAirport(ZRH);
    // Published true headings (OurAirports / AIP) for each runway end.
    const expected: Record<string, number> = {
      "10": 96,
      "28": 276,
      "14": 137,
      "32": 317,
      "16": 155,
      "34": 335,
    };
    expect(ap.ends).toHaveLength(6);
    for (const [id, brg] of Object.entries(expected)) {
      expect(angleDelta(ap.endById[id].bearingDeg, brg), `runway ${id}`).toBeLessThan(3);
    }
  });

  it("derives strips, opposites and pre-projected centrelines generically", () => {
    const ap = buildAirport(ZRH);
    expect(ap.strips.map((s) => s.name)).toEqual(["16/34", "14/32", "10/28"]);
    expect(ap.endById["28"].opposite).toBe("10");
    expect(ap.endById["28"].strip).toBe("10/28");
    expect(ap.stripPairs).toHaveLength(3);
    // Centrelines are pre-projected around the ARP (so runway 0 has a nonzero span).
    expect(ap.endsLocal).toHaveLength(6);
    const a = ap.endsLocal[0];
    expect(Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y)).toBeGreaterThan(1000);
  });

  it("builds any airport from config alone (BKK parallels, ~014°/194°)", () => {
    const ap = buildAirport(BKK);
    expect(ap.ends).toHaveLength(6);
    expect(ap.strips.map((s) => s.name)).toEqual(["01/19", "02R/20L", "02L/20R"]);
    // All three physical runways are parallel, heading roughly north (~14° T).
    for (const strip of ["01", "02R", "02L"]) {
      expect(angleDelta(ap.endById[strip].bearingDeg, 14), `end ${strip}`).toBeLessThan(6);
    }
    expect(angleDelta(ap.endById["19"].bearingDeg, 194)).toBeLessThan(6);
  });

  it("projects the active airport's runways centred within the SVG frame", () => {
    const ap = buildAirport(BKK);
    const center = projectToSvg(ap.config.arp, ap.config.arp);
    expect(center.x).toBeCloseTo(SVG_W / 2, 3);
    expect(center.y).toBeCloseTo(SVG_H / 2, 3);
    // Every BKK threshold lands inside the frame near the centre.
    for (const s of ap.strips) {
      for (const p of [s.a, s.b]) {
        const pt = projectToSvg(ap.config.arp, p);
        expect(pt.x).toBeGreaterThan(0);
        expect(pt.x).toBeLessThan(SVG_W);
        expect(pt.y).toBeGreaterThan(0);
        expect(pt.y).toBeLessThan(SVG_H);
      }
    }
  });

  it("runs the full assign → predict pipeline for a non-ZRH airport (BKK)", () => {
    const ap = buildAirport(BKK);
    // A jet 5 km out on final to runway 19, on the extended centreline, descending.
    const end = ap.endById["19"];
    const behind = destinationPoint(end.threshold, (end.bearingDeg + 180) % 360, 5000);
    const ac: Aircraft = {
      hex: "bkk1",
      flight: "THA100",
      lat: behind.lat,
      lon: behind.lon,
      altFt: 2000,
      onGround: false,
      gs: 150,
      track: end.bearingDeg,
      verticalRateFpm: -700,
      seenPos: 1,
      type: "B77W",
      typeDesc: null,
      registration: "HS-TKA",
    };
    const assignment = assignRunway(ap as Airport, ac);
    expect(assignment?.end).toBe("19");
    expect(assignment?.phase).toBe("approach");
    expect(assignment?.strip).toBe("01/19");

    const [arr] = predictArrivals([{ ac, assignment }]);
    expect(arr.end).toBe("19");
    expect(arr.strip).toBe("01/19");
    expect(arr.distanceNm).toBeGreaterThan(2);
  });
});
