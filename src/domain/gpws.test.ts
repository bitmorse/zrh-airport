import { describe, expect, it } from "vitest";
import { createGpwsState, gpwsAdvance, heightAglFt } from "./gpws";

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

const descend = { descending: true, onGround: false };
const keys = (cues: { key: string }[]) => cues.map((c) => c.key);

describe("gpwsAdvance", () => {
  it("fires each callout once as it descends, incl. minimums and retard", () => {
    const s = createGpwsState(3000); // starting high — nothing pre-marked
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 550 }))).toEqual(["2500", "1000"]);
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 250 }))).toEqual(["500", "400", "300"]);
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 190 }))).toEqual(["minimums"]);
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 25 }))).toEqual(["100", "50", "40", "30"]);
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 15 }))).toEqual(["retard"]);
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 8 }))).toEqual(["10"]);
  });

  it("does not repeat a callout when height bobs near the ground", () => {
    const s = createGpwsState(3000);
    gpwsAdvance(s, { ...descend, aglFt: 8 }); // announces everything down to "10"
    // Noise: bobs up then down through 10 again — must stay silent.
    expect(gpwsAdvance(s, { ...descend, aglFt: 14 })).toEqual([]);
    expect(gpwsAdvance(s, { ...descend, aglFt: 6 })).toEqual([]);
  });

  it("skips callouts above the height it started at", () => {
    const s = createGpwsState(450); // enabled mid-approach at 450 ft
    // 2500/1000/500 are already 'announced' → only 400 and below can fire.
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 380 }))).toEqual(["400"]);
  });

  it("stays silent on the ground or while climbing", () => {
    const s = createGpwsState(3000);
    expect(gpwsAdvance(s, { aglFt: 30, descending: true, onGround: true })).toEqual([]);
    expect(gpwsAdvance(s, { aglFt: 30, descending: false, onGround: false })).toEqual([]);
  });

  it("re-arms after a climb (go-around) so the next approach re-announces", () => {
    const s = createGpwsState(3000);
    gpwsAdvance(s, { ...descend, aglFt: 8 }); // announces everything down to 10
    gpwsAdvance(s, { aglFt: 3000, descending: false, onGround: false }); // climb → re-arm
    expect(keys(gpwsAdvance(s, { ...descend, aglFt: 450 }))).toContain("500");
  });
});
