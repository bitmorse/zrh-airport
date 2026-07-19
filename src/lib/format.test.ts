import { describe, expect, it } from "vitest";
import {
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatVerticalRate,
} from "./format";

describe("unit formatting", () => {
  it("converts distance to metric by default, NM in aviation mode", () => {
    expect(formatDistance(10, "metric")).toBe("18.5 km");
    expect(formatDistance(0.2, "metric")).toBe("370 m"); // < 1 km → metres
    expect(formatDistance(10, "imperial")).toBe("10.0 NM");
  });

  it("converts speed", () => {
    expect(formatSpeed(140, "metric")).toBe("259 km/h");
    expect(formatSpeed(140, "imperial")).toBe("140 kt");
  });

  it("converts altitude", () => {
    expect(formatAltitude(4000, "metric")).toBe("1,219 m");
    expect(formatAltitude(4000, "imperial")).toBe("4,000 ft");
  });

  it("converts vertical rate with a direction arrow", () => {
    expect(formatVerticalRate(1650, "metric")).toBe("↑ 8.4 m/s");
    expect(formatVerticalRate(-640, "imperial")).toBe("↓ 640 fpm");
    expect(formatVerticalRate(0, "metric")).toBe("→ 0.0 m/s");
  });
});
