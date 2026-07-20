import { describe, expect, it } from "vitest";
import type { RunwayAssignment } from "./assignRunway";
import { fieldRelation, routeConflict } from "./routeCheck";

const ac = (over: Partial<{ onGround: boolean; verticalRateFpm: number | null }> = {}) => ({
  onGround: false,
  verticalRateFpm: 0,
  ...over,
});
const assign = (phase: RunwayAssignment["phase"]): RunwayAssignment => ({
  end: "16",
  strip: "16/34",
  phase,
  crossTrackM: 0,
  alongTrackM: 0,
});
const ap = (iata: string, icao = "") => ({ iata, icao, name: null, municipality: null, countryIso: null });

describe("fieldRelation", () => {
  it("uses the runway phase when known", () => {
    expect(fieldRelation(ac({ verticalRateFpm: -800 }), assign("departure"))).toBe("departing");
    expect(fieldRelation(ac({ verticalRateFpm: 800 }), assign("approach"))).toBe("arriving");
  });

  it("falls back to vertical rate, and is undecided when level / on the ground", () => {
    expect(fieldRelation(ac({ verticalRateFpm: 1500 }), null)).toBe("departing");
    expect(fieldRelation(ac({ verticalRateFpm: -1200 }), null)).toBe("arriving");
    expect(fieldRelation(ac({ verticalRateFpm: 0 }), null)).toBe("unknown");
    expect(fieldRelation(ac({ verticalRateFpm: null }), null)).toBe("unknown");
    expect(fieldRelation(ac({ onGround: true, verticalRateFpm: 1500 }), null)).toBe("unknown");
  });
});

describe("routeConflict", () => {
  const inbound = { origin: ap("MAD", "LEMD"), destination: ap("ZRH", "LSZH") };

  it("flags a plane departing home while the route ends here (stale inbound callsign)", () => {
    // The reported bug: AEA81TY climbing out of ZRH but adsbdb says MAD→ZRH.
    expect(routeConflict(inbound, "ZRH", "LSZH", "departing")).toBe("departing-inbound-route");
  });

  it("flags a plane arriving home while the route starts here", () => {
    const outbound = { origin: ap("ZRH", "LSZH"), destination: ap("BCN", "LEBL") };
    expect(routeConflict(outbound, "ZRH", "LSZH", "arriving")).toBe("arriving-outbound-route");
  });

  it("does not flag consistent routes", () => {
    expect(routeConflict(inbound, "ZRH", "LSZH", "arriving")).toBeNull(); // normal arrival
    const outbound = { origin: ap("ZRH", "LSZH"), destination: ap("BCN", "LEBL") };
    expect(routeConflict(outbound, "ZRH", "LSZH", "departing")).toBeNull(); // normal departure
  });

  it("matches home by IATA or ICAO, and is silent when direction is unknown or home isn't an endpoint", () => {
    expect(routeConflict(inbound, "ZZZ", "LSZH", "departing")).toBe("departing-inbound-route"); // ICAO match
    expect(routeConflict(inbound, "ZRH", "LSZH", "unknown")).toBeNull();
    const overflight = { origin: ap("LHR"), destination: ap("MXP") };
    expect(routeConflict(overflight, "ZRH", "LSZH", "departing")).toBeNull(); // home is neither endpoint
    expect(routeConflict(null, "ZRH", "LSZH", "departing")).toBeNull();
  });
});
