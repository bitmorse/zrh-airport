import { describe, expect, it } from "vitest";
import {
  countryPath,
  followViewBox,
  graticulePath,
  greatCircleSegments,
  project,
} from "./worldMap";

describe("project", () => {
  it("maps lon/lat into the 360x180 world space (north up)", () => {
    expect(project(0, 0)).toEqual({ x: 180, y: 90 });
    expect(project(-180, 90)).toEqual({ x: 0, y: 0 });
    expect(project(180, -90)).toEqual({ x: 360, y: 180 });
  });
});

describe("countryPath", () => {
  it("emits an SVG path with a subpath per ring", () => {
    const d = countryPath([
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    ]);
    expect(d).toBe("M180.00 90.00L190.00 90.00L190.00 80.00Z");
  });
});

describe("graticulePath", () => {
  it("returns meridians and parallels", () => {
    const d = graticulePath(30);
    expect(d).toMatch(/^M/);
    expect(d.split("M").length).toBeGreaterThan(5);
  });
});

describe("greatCircleSegments", () => {
  it("starts and ends at the endpoints", () => {
    const segs = greatCircleSegments({ lat: 51.47, lon: -0.46 }, { lat: 40.64, lon: -73.78 });
    const first = segs[0][0];
    const last = segs[segs.length - 1][segs[segs.length - 1].length - 1];
    expect(first.x).toBeCloseTo(project(-0.46, 51.47).x, 1);
    expect(last.x).toBeCloseTo(project(-73.78, 40.64).x, 1);
    expect(segs.length).toBe(1); // no antimeridian crossing on this route
  });

  it("splits into multiple segments across the antimeridian", () => {
    const segs = greatCircleSegments({ lat: 35, lon: 139 }, { lat: 37, lon: -122 }); // Tokyo→SF
    expect(segs.length).toBeGreaterThan(1);
  });
});

describe("followViewBox", () => {
  it("centres the box on the projected point", () => {
    const vb = followViewBox(0, 0, 40, 1.5).split(" ").map(Number);
    // centre (180,90), height 40, width 60 → x=150 y=70 w=60 h=40
    expect(vb).toEqual([150, 70, 60, 40]);
  });
});
