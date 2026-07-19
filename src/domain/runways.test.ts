import { describe, expect, it } from "vitest";
import { RUNWAY_END_BY_ID } from "./runways";

/** Smallest absolute difference between two bearings, in [0, 180]. */
function bearingDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

describe("runway geometry", () => {
  // Published true headings (OurAirports / AIP) for each runway end.
  const expected: Record<string, number> = {
    "10": 96,
    "28": 276,
    "14": 137,
    "32": 317,
    "16": 155,
    "34": 335,
  };

  it("threshold coordinates yield the correct true headings", () => {
    for (const [id, brg] of Object.entries(expected)) {
      const end = RUNWAY_END_BY_ID[id];
      expect(bearingDiff(end.bearingDeg, brg), `runway ${id}`).toBeLessThan(3);
    }
  });
});
