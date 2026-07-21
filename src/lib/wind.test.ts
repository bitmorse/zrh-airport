import { describe, expect, it } from "vitest";
import { isGusty, windComponents } from "./wind";

describe("windComponents", () => {
  it("pure headwind: wind from straight ahead is all head, no cross", () => {
    // Travelling north (0°), wind from the north (0°).
    const w = windComponents(0, 0, 20);
    expect(w.headKt).toBeCloseTo(20, 5);
    expect(w.crossKt).toBeCloseTo(0, 5);
    expect(w.fromSide).toBe("");
  });

  it("pure tailwind: wind from directly behind is negative head", () => {
    const w = windComponents(0, 180, 20);
    expect(w.headKt).toBeCloseTo(-20, 5);
    expect(w.crossKt).toBeCloseTo(0, 5);
  });

  it("wind from the right pushes the aircraft to the left", () => {
    // Travelling north (0°), wind from the east (90°, the aircraft's right).
    const w = windComponents(0, 90, 15);
    expect(w.crossKt).toBeCloseTo(15, 5);
    expect(w.headKt).toBeCloseTo(0, 5);
    expect(w.fromSide).toBe("R");
    expect(w.pushDeg).toBeCloseTo(270, 5); // pushed toward the west (left of north)
  });

  it("wind from the left pushes the aircraft to the right", () => {
    // Travelling north (0°), wind from the west (270°, the aircraft's left).
    const w = windComponents(0, 270, 15);
    expect(w.crossKt).toBeCloseTo(15, 5);
    expect(w.fromSide).toBe("L");
    expect(w.pushDeg).toBeCloseTo(90, 5); // pushed toward the east (right of north)
  });

  it("quartering wind splits into head and cross by the cosine/sine", () => {
    // 45° off the nose, from the right.
    const w = windComponents(0, 45, 20);
    expect(w.headKt).toBeCloseTo(20 * Math.SQRT1_2, 4);
    expect(w.crossKt).toBeCloseTo(20 * Math.SQRT1_2, 4);
    expect(w.fromSide).toBe("R");
  });

  it("respects the travel bearing, not just north", () => {
    // Travelling east (90°), wind from the south (180°) → from the right → push north.
    const w = windComponents(90, 180, 10);
    expect(w.crossKt).toBeCloseTo(10, 5);
    expect(w.fromSide).toBe("R");
    expect(w.pushDeg).toBeCloseTo(0, 5); // pushed toward the north
  });

  it("handles wraparound at the 0/360 seam", () => {
    // Travelling 350°, wind from 10° (20° to the right).
    const w = windComponents(350, 10, 20);
    expect(w.fromSide).toBe("R");
    expect(w.headKt).toBeGreaterThan(0); // mostly a headwind
    expect(w.crossKt).toBeGreaterThan(0);
  });

  it("clamps a non-finite or negative speed to zero", () => {
    expect(windComponents(0, 90, Number.NaN).crossKt).toBe(0);
    expect(windComponents(0, 90, -5).crossKt).toBe(0);
  });
});

describe("isGusty", () => {
  it("is true when the gust exceeds the sustained wind by ≥10 kt", () => {
    expect(isGusty(12, 22)).toBe(true);
    expect(isGusty(12, 25)).toBe(true);
  });

  it("is false for a small spread or missing data", () => {
    expect(isGusty(12, 18)).toBe(false);
    expect(isGusty(null, 25)).toBe(false);
    expect(isGusty(12, null)).toBe(false);
  });
});
