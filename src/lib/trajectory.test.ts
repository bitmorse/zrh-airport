import { describe, expect, it } from "vitest";
import { fitPath } from "./trajectory";

const P = (lat: number, lon: number) => ({ lat, lon });

describe("fitPath", () => {
  it("fits a path into the padded box, north up, and reprojects consistently", () => {
    // origin, one due east, one due north.
    const pts = [P(47.4, 8.5), P(47.4, 8.52), P(47.42, 8.5)];
    const { pts: s, project } = fitPath(pts, 200, 120, 10);

    for (const p of s) {
      expect(p.x).toBeGreaterThanOrEqual(10 - 0.01);
      expect(p.x).toBeLessThanOrEqual(190 + 0.01);
      expect(p.y).toBeGreaterThanOrEqual(10 - 0.01);
      expect(p.y).toBeLessThanOrEqual(110 + 0.01);
    }
    expect(s[1].x).toBeGreaterThan(s[0].x); // east → larger x
    expect(s[2].y).toBeLessThan(s[0].y); // north → smaller y (north up)

    const o = project(pts[0]); // same transform reproduces the first point
    expect(o.x).toBeCloseTo(s[0].x, 3);
    expect(o.y).toBeCloseTo(s[0].y, 3);
  });

  it("handles empty input", () => {
    expect(fitPath([], 200, 120).pts).toEqual([]);
  });
});
