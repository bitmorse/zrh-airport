import { describe, expect, it } from "vitest";
import { formatAltitude, formatDistance, formatSpeed } from "./format";

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
});
