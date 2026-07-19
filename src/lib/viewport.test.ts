import { describe, expect, it } from "vitest";
import { SVG_W } from "./projection";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampCenter,
  clampZoom,
  computeViewBox,
  panBy,
  zoomAtPoint,
} from "./viewport";

describe("clampZoom", () => {
  it("clamps to [MIN_ZOOM, MAX_ZOOM]", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
    expect(clampZoom(3)).toBe(3);
  });
});

describe("clampCenter", () => {
  it("pins the centre to 0.5 at zoom 1", () => {
    expect(clampCenter(1, 0.1)).toBeCloseTo(0.5);
    expect(clampCenter(1, 0.9)).toBeCloseTo(0.5);
  });
  it("keeps the visible box inside the world when zoomed in", () => {
    // At zoom 2 the box is half the world, so centre is limited to [0.25, 0.75].
    expect(clampCenter(2, 0)).toBeCloseTo(0.25);
    expect(clampCenter(2, 1)).toBeCloseTo(0.75);
  });
});

describe("computeViewBox", () => {
  it("fills the world at zoom 1", () => {
    const b = computeViewBox({ zoom: 1, cx: 0.5, cy: 0.5 });
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(SVG_W);
  });
  it("halves dimensions at zoom 2", () => {
    const b = computeViewBox({ zoom: 2, cx: 0.5, cy: 0.5 });
    expect(b.w).toBeCloseTo(SVG_W / 2);
  });
});

describe("zoomAtPoint", () => {
  it("keeps the focus point stationary while zooming in", () => {
    const start = { zoom: 1, cx: 0.5, cy: 0.5 };
    // Focus on the top-left corner of the viewport.
    const zoomed = zoomAtPoint(start, 2, 0, 0);
    const box = computeViewBox(zoomed);
    // The world point that was at the top-left should still be at the top-left.
    expect(box.x).toBeCloseTo(0, 1);
    expect(box.y).toBeCloseTo(0, 1);
    expect(zoomed.zoom).toBe(2);
  });
  it("does not move when already at max zoom", () => {
    const start = { zoom: MAX_ZOOM, cx: 0.5, cy: 0.5 };
    expect(zoomAtPoint(start, 2, 0.3, 0.7)).toEqual(start);
  });
});

describe("panBy", () => {
  it("shifts the centre and re-clamps", () => {
    const panned = panBy({ zoom: 2, cx: 0.5, cy: 0.5 }, 0.25, 0);
    expect(panned.cx).toBeGreaterThan(0.5);
    // Cannot pan past the world edge.
    const maxed = panBy({ zoom: 2, cx: 0.5, cy: 0.5 }, 5, 0);
    expect(maxed.cx).toBeCloseTo(0.75);
  });
});
