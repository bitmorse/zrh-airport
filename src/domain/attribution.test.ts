import { describe, expect, it } from "vitest";
import type { TrailPoint } from "../data/watchStore";
import { destinationPoint, type LatLon } from "../lib/geo";
import {
  attributeCandidates,
  CAPTURE_RADIUS_M,
  type AttributionAircraft,
} from "./attribution";

const USER: LatLon = { lat: 47.4647, lon: 8.5492 };
const FIELD_FT = 1416; // ZRH field elevation
const T0 = 1_700_000_000_000;
const WINDOW = { start: T0, end: T0 + 30_000 };

/** A one-sample aircraft `distM` metres from the user on `bearing`, at `altFt` MSL. */
function ac(
  hex: string,
  distM: number,
  bearing: number,
  altFt: number | null,
  over: Partial<AttributionAircraft> = {},
): AttributionAircraft {
  const p = destinationPoint(USER, bearing, distM);
  const trail: TrailPoint[] = [{ lat: p.lat, lon: p.lon, alt: altFt, t: T0 + 15_000 }];
  return {
    hex,
    callsign: hex.toUpperCase(),
    aircraftType: "A320",
    aircraftTypeDesc: null,
    registration: null,
    gsKt: 150,
    altFt,
    trackDeg: 90,
    verticalRateFpm: null,
    trail,
    ...over,
  };
}

const staticObserver = [{ t: T0, lat: USER.lat, lon: USER.lon }];

describe("attributeCandidates", () => {
  it("ranks candidates by closest approach and picks the nearest as primary", () => {
    const res = attributeCandidates({
      window: WINDOW,
      observer: staticObserver,
      fieldElevationFt: FIELD_FT,
      aircraft: [ac("far", 2000, 90, FIELD_FT), ac("near", 300, 90, FIELD_FT)],
    });
    expect(res.candidates.map((c) => c.hex)).toEqual(["near", "far"]);
    expect(res.primaryHex).toBe("near");
    expect(res.candidates[0].closestApproachM).toBeCloseTo(300, -2);
  });

  it("uses slant range: a low distant plane beats a horizontally-near but very high one", () => {
    // "high" is 400 m horizontally but ~10000 ft (~3 km) above field → big slant range.
    // "low" is 1200 m horizontally near field level → smaller slant range.
    const res = attributeCandidates({
      window: WINDOW,
      observer: staticObserver,
      fieldElevationFt: FIELD_FT,
      aircraft: [ac("high", 400, 0, FIELD_FT + 10000), ac("low", 1200, 180, FIELD_FT + 50)],
    });
    expect(res.primaryHex).toBe("low");
  });

  it("excludes aircraft whose closest approach is beyond the capture radius", () => {
    const res = attributeCandidates({
      window: WINDOW,
      observer: staticObserver,
      fieldElevationFt: FIELD_FT,
      aircraft: [ac("out", CAPTURE_RADIUS_M + 1500, 90, FIELD_FT)],
    });
    expect(res.candidates).toEqual([]);
    expect(res.primaryHex).toBeNull();
  });

  it("treats on-ground (null altitude) as height 0 above field", () => {
    const res = attributeCandidates({
      window: WINDOW,
      observer: staticObserver,
      fieldElevationFt: FIELD_FT,
      aircraft: [ac("gate", 150, 45, null)],
    });
    expect(res.primaryHex).toBe("gate");
    expect(res.candidates[0].closestApproachM).toBeCloseTo(150, -2);
  });

  it("returns nothing when there is no observer fix or no aircraft", () => {
    expect(
      attributeCandidates({
        window: WINDOW,
        observer: [],
        fieldElevationFt: FIELD_FT,
        aircraft: [ac("x", 300, 90, FIELD_FT)],
      }).primaryHex,
    ).toBeNull();
    expect(
      attributeCandidates({
        window: WINDOW,
        observer: staticObserver,
        fieldElevationFt: FIELD_FT,
        aircraft: [],
      }).primaryHex,
    ).toBeNull();
  });

  it("ignores trail points outside the clip window", () => {
    const p = destinationPoint(USER, 90, 200);
    const a: AttributionAircraft = {
      ...ac("t", 200, 90, FIELD_FT),
      trail: [
        { lat: p.lat, lon: p.lon, alt: FIELD_FT, t: T0 - 60_000 }, // well before window
        { lat: p.lat, lon: p.lon, alt: FIELD_FT, t: T0 + 120_000 }, // well after window
      ],
    };
    const res = attributeCandidates({
      window: WINDOW,
      observer: staticObserver,
      fieldElevationFt: FIELD_FT,
      aircraft: [a],
    });
    expect(res.candidates).toEqual([]); // no in-window samples
  });

  it("uses the moving observer track (interpolated) for distance", () => {
    // Aircraft parked at a fixed point sampled mid-window; observer walks from far to
    // near across the window, so the interpolated position at the sample is closer
    // than the start fix — verify the moving series is actually used.
    const acPoint = destinationPoint(USER, 90, 100);
    const parked: AttributionAircraft = {
      ...ac("p", 100, 90, FIELD_FT),
      trail: [{ lat: acPoint.lat, lon: acPoint.lon, alt: FIELD_FT, t: T0 + 15_000 }],
    };
    const startFar = destinationPoint(acPoint, 270, 2000); // observer 2 km west of plane at t0
    const movingObserver = [
      { t: T0, lat: startFar.lat, lon: startFar.lon },
      { t: T0 + 30_000, lat: acPoint.lat, lon: acPoint.lon }, // reaches the plane at end
    ];
    const moving = attributeCandidates({
      window: WINDOW,
      observer: movingObserver,
      fieldElevationFt: FIELD_FT,
      aircraft: [parked],
    });
    const still = attributeCandidates({
      window: WINDOW,
      observer: [{ t: T0, lat: startFar.lat, lon: startFar.lon }],
      fieldElevationFt: FIELD_FT,
      aircraft: [parked],
    });
    // Halfway through, the walker is ~1 km from the plane vs. ~2 km if static.
    expect(moving.candidates[0].closestApproachM).toBeLessThan(
      still.candidates[0].closestApproachM,
    );
    expect(moving.candidates[0].closestApproachM).toBeCloseTo(1000, -2.4);
  });
});
