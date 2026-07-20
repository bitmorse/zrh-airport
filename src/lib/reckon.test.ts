import { describe, expect, it } from "vitest";
import { haversineMeters } from "./geo";
import { reckonAltFt, reckonDistanceNm, reckonPosition } from "./reckon";

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
    const far = 140 * KT_TO_MS * 60; // capped at 60 s
    expect(haversineMeters({ lat: 47.4, lon: 8.5 }, capped)).toBeCloseTo(far, -1);
  });
});

describe("reckon helpers", () => {
  it("reckonAltFt advances by vertical rate; reckonDistanceNm closes by groundspeed", () => {
    expect(reckonAltFt(1000, 600, 10)).toBe(1100); // +600 fpm for 10 s = +100 ft
    expect(reckonDistanceNm(1, 140, 5)).toBeLessThan(1);
    expect(reckonDistanceNm(0.01, 140, 60)).toBe(0); // clamped at 0
  });
});
