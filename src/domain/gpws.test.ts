import { describe, expect, it } from "vitest";
import { heightAglFt, nextCallouts } from "./gpws";

describe("heightAglFt", () => {
  const base = { altGeomFt: null, altFt: null, onGround: false };

  it("prefers GNSS altitude, corrected by field elevation and geoid", () => {
    expect(heightAglFt({ ...base, altGeomFt: 1700 }, 1416, 157)).toBe(127);
  });

  it("falls back to barometric when no GNSS altitude", () => {
    expect(heightAglFt({ ...base, altFt: 1616 }, 1416, 157)).toBe(200);
  });

  it("is zero on the ground", () => {
    expect(heightAglFt({ altGeomFt: 1700, altFt: 1616, onGround: true }, 1416, 157)).toBe(0);
  });
});

describe("nextCallouts", () => {
  it("returns each callout crossed on the way down, once, none skipped", () => {
    expect(nextCallouts(120, 45).map((c) => c.ft)).toEqual([100, 50]);
    // The next sample continues below without repeating 50.
    expect(nextCallouts(45, 8).map((c) => c.ft)).toEqual([40, 30, 20, 10]);
  });

  it("says nothing when level or climbing", () => {
    expect(nextCallouts(300, 300)).toEqual([]);
    expect(nextCallouts(300, 800)).toEqual([]);
  });
});
