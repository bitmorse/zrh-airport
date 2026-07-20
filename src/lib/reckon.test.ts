import { describe, expect, it } from "vitest";
import { destinationPoint, haversineMeters } from "./geo";
import { headingFromTrail, reckonAltFt, reckonDistanceNm, reckonPosition } from "./reckon";

const KT_TO_MS = 0.514444;

function ac(over: Partial<Parameters<typeof reckonPosition>[0]> = {}) {
  return { lat: 47.4, lon: 8.5, onGround: false, gs: 140, track: 90, seenPos: 0, ...over };
}

describe("reckonPosition", () => {
  it("advances an airborne aircraft along its track by gs·time", () => {
    const start = ac();
    const p = reckonPosition(start, 1000, 1000 + 10_000); // 10 s later
    const expected = 140 * KT_TO_MS * 10; // metres
    expect(haversineMeters({ lat: start.lat, lon: start.lon }, p)).toBeCloseTo(expected, -1);
    expect(p.lon).toBeGreaterThan(start.lon); // track 090° → moves east
  });

  it("returns the raw position when slow-taxiing, stopped, or with no poll time", () => {
    const raw = { lat: 47.4, lon: 8.5 };
    expect(reckonPosition(ac({ onGround: true, gs: 12 }), 1000, 99_000)).toEqual(raw); // taxi
    expect(reckonPosition(ac({ gs: 0 }), 1000, 99_000)).toEqual(raw);
    expect(reckonPosition(ac({ track: null }), 1000, 99_000)).toEqual(raw);
    expect(reckonPosition(ac(), null, 99_000)).toEqual(raw);
  });

  it("advances a fast aircraft on the ground (takeoff/landing roll) along its track", () => {
    const start = ac({ onGround: true, gs: 95 }); // ~176 km/h — clearly rolling
    const p = reckonPosition(start, 1000, 1000 + 4_000); // 4 s later
    const expected = 95 * KT_TO_MS * 4; // metres down the runway
    expect(haversineMeters({ lat: start.lat, lon: start.lon }, p)).toBeCloseTo(expected, -1);
    expect(p.lon).toBeGreaterThan(start.lon); // track 090° → moves east
  });

  it("caps extrapolation so a stalled feed doesn't fling the aircraft away", () => {
    const capped = reckonPosition(ac(), 0, 10 * 60 * 1000); // 10 min stall
    const far = 140 * KT_TO_MS * 90; // capped at MAX_EXTRAPOLATE_S (90 s)
    expect(haversineMeters({ lat: 47.4, lon: 8.5 }, capped)).toBeCloseTo(far, -1);
  });

  it("keeps gliding through a 30 s polling outage (does not freeze)", () => {
    const start = ac({ gs: 150 });
    const at5 = reckonPosition(start, 1000, 1000 + 5_000);
    const at30 = reckonPosition(start, 1000, 1000 + 30_000); // still well under the cap
    // Position keeps advancing along track across the outage — no freeze.
    expect(haversineMeters({ lat: 47.4, lon: 8.5 }, at30)).toBeGreaterThan(
      haversineMeters({ lat: 47.4, lon: 8.5 }, at5),
    );
  });
});

describe("headingFromTrail", () => {
  const origin = { lat: 47.4, lon: 8.5 };

  it("returns the bearing of actual travel from the trail (fixes ground heading)", () => {
    // Two fixes 100 m apart on a 090° (due-east) track.
    const p1 = origin;
    const p2 = destinationPoint(origin, 90, 100);
    expect(headingFromTrail([p1, p2])).toBeCloseTo(90, 0);

    // North-east travel.
    expect(headingFromTrail([origin, destinationPoint(origin, 45, 80)])).toBeCloseTo(45, 0);
  });

  it("ignores sub-threshold jitter (returns null when it hasn't really moved)", () => {
    const jitter = destinationPoint(origin, 200, 4); // 4 m — below the 20 m guard
    expect(headingFromTrail([origin, jitter])).toBeNull();
    expect(headingFromTrail([origin])).toBeNull(); // too few points
  });

  it("skips back over a too-close latest point to the last real displacement", () => {
    const c = origin; // newest fix
    const b = destinationPoint(c, 200, 5); // 5 m jitter just before it (skipped)
    const a = destinationPoint(c, 270, 100); // 100 m west of c → a→c bearing is due east
    expect(headingFromTrail([a, b, c])).toBeCloseTo(90, 0);
  });
});

describe("reckon helpers", () => {
  it("reckonAltFt advances by vertical rate; reckonDistanceNm closes by groundspeed", () => {
    expect(reckonAltFt(1000, 600, 10)).toBe(1100); // +600 fpm for 10 s = +100 ft
    expect(reckonDistanceNm(1, 140, 5)).toBeLessThan(1);
    expect(reckonDistanceNm(0.01, 140, 60)).toBe(0); // clamped at 0
  });
});
