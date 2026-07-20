import { describe, expect, it } from "vitest";
import { destinationPoint, type LatLon } from "../lib/geo";
import { insideFence, stillInFence } from "./geofence";

const USER: LatLon = { lat: 47.4647, lon: 8.5492 };
const FIELD_FT = 1416; // ZRH field elevation

/** Aircraft `distM` metres from the user on `bearing`, airborne at 2000 ft by default. */
function at(
  hex: string,
  distM: number,
  bearing: number,
  over: Partial<{ onGround: boolean; altFt: number | null }> = {},
) {
  const p = destinationPoint(USER, bearing, distM);
  return { hex, lat: p.lat, lon: p.lon, onGround: false, altFt: 2000, ...over };
}

describe("insideFence", () => {
  it("returns low aircraft within the radius, nearest first", () => {
    const acs = [
      at("near", 1000, 90),
      at("far", 5000, 90), // outside the 3 km radius
      at("high", 500, 0, { altFt: 40000 }), // inside radius but far too high to hear
      at("ground", 2000, 180, { onGround: true, altFt: null }), // on the ground, counts
    ];
    const res = insideFence(USER, 3000, acs, FIELD_FT);
    expect(res.map((r) => r.hex)).toEqual(["near", "ground"]);
    expect(res[0].distM).toBeCloseTo(1000, -2);
  });
});

describe("stillInFence", () => {
  it("keeps a target inside until it passes the exit margin, and drops high/absent targets", () => {
    expect(stillInFence(USER, 3000, at("x", 1000, 90), FIELD_FT)).toBe(true);
    expect(stillInFence(USER, 3000, at("x", 3100, 90), FIELD_FT)).toBe(true); // within +200 m margin
    expect(stillInFence(USER, 3000, at("x", 3300, 90), FIELD_FT)).toBe(false); // beyond margin
    expect(stillInFence(USER, 3000, undefined, FIELD_FT)).toBe(false); // gone from the feed
    expect(stillInFence(USER, 3000, at("x", 1000, 90, { altFt: 40000 }), FIELD_FT)).toBe(false);
  });
});
