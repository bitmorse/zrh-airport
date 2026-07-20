import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import { pickInteresting, shouldRelease } from "./autoSelect";
import type { DepartureEvent } from "./departures";
import type { Arrival } from "./predictions";

function ac(over: Partial<Aircraft>): AircraftWithAssignment {
  return {
    ac: {
      hex: "x",
      flight: null,
      lat: 47.4,
      lon: 8.5,
      altFt: null,
      altGeomFt: null,
      onGround: false,
      gs: 150,
      track: 90,
      verticalRateFpm: null,
      seenPos: 0,
      type: null,
      typeDesc: null,
      registration: null,
      ...over,
    },
    assignment: null,
  };
}
const arr = (hex: string, etaSeconds: number): Arrival => ({
  end: "28",
  strip: "10/28",
  hex,
  callsign: hex,
  etaSeconds,
  distanceNm: 1,
  gsKt: 150,
});
const dep = (hex: string, phase: DepartureEvent["phase"]): DepartureEvent => ({
  end: "16",
  strip: "16/34",
  hex,
  callsign: hex,
  phase,
  gsKt: phase === "climb" ? 160 : 60,
});

// fieldElevation 0 + geoid 0 ⇒ AGL == altFt for these fixtures.
describe("pickInteresting", () => {
  it("prefers a stabilized/short-final arrival over departures", () => {
    const aircraft = [
      ac({ hex: "a1", altFt: 500 }), // AGL 500 ⇒ stabilized (tier 0)
      ac({ hex: "d1", onGround: true }),
      ac({ hex: "d2", altFt: 800 }),
    ];
    expect(
      pickInteresting([arr("a1", 60)], [dep("d1", "roll"), dep("d2", "climb")], aircraft, 0, 0),
    ).toBe("a1");
  });

  it("ranks on-final arrival above a departure roll", () => {
    const aircraft = [ac({ hex: "a1", altFt: 3000 }), ac({ hex: "d1", onGround: true })];
    expect(pickInteresting([arr("a1", 200)], [dep("d1", "roll")], aircraft, 0, 0)).toBe("a1");
  });

  it("prefers a higher arrival (fuller GPWS) over one already on short final", () => {
    const aircraft = [ac({ hex: "high", altFt: 1500 }), ac({ hex: "low", altFt: 400 })];
    // "low" is sooner, but "high" still has the full countdown ahead ⇒ pick it.
    expect(pickInteresting([arr("high", 70), arr("low", 30)], [], aircraft, 0, 0)).toBe("high");
  });

  it("deprioritises a rolled-out (on-ground) arrival below one still airborne on final", () => {
    const aircraft = [ac({ hex: "rollout", onGround: true }), ac({ hex: "final", altFt: 400 })];
    expect(pickInteresting([arr("rollout", 0), arr("final", 40)], [], aircraft, 0, 0)).toBe("final");
  });

  it("falls to roll, then to the lowest climber, when no arrival is imminent", () => {
    expect(
      pickInteresting([], [dep("d1", "roll"), dep("d2", "climb")], [ac({ hex: "d2", altFt: 800 })], 0, 0),
    ).toBe("d1");
    expect(
      pickInteresting(
        [],
        [dep("d1", "climb"), dep("d2", "climb")],
        [ac({ hex: "d1", altFt: 900 }), ac({ hex: "d2", altFt: 300 })],
        0,
        0,
      ),
    ).toBe("d2");
  });

  it("ignores distant inbounds (not imminent) and returns null", () => {
    expect(pickInteresting([arr("a1", 600)], [], [ac({ hex: "a1", altFt: 5000 })], 0, 0)).toBeNull();
    expect(pickInteresting([], [], [], 0, 0)).toBeNull();
  });
});

describe("shouldRelease", () => {
  it("releases on disappearance, near-stop on ground, or a climber leaving the viewport", () => {
    expect(shouldRelease(undefined, true, false)).toBe(true); // gone from feed
    expect(shouldRelease({ onGround: true, gs: 5 }, true, false)).toBe(true); // stopped
    expect(shouldRelease({ onGround: true, gs: 50 }, true, false)).toBe(false); // still rolling out
    expect(shouldRelease({ onGround: false, gs: 150 }, true, true)).toBe(false); // climbing, in view
    expect(shouldRelease({ onGround: false, gs: 150 }, false, true)).toBe(true); // climbed out of view
    // A descending arrival panned out of view is NOT dropped (only climbers are).
    expect(shouldRelease({ onGround: false, gs: 150 }, false, false)).toBe(false);
  });
});
