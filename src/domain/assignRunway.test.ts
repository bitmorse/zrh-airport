import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { assignRunway } from "./assignRunway";
import { RUNWAY_END_BY_ID } from "./runways";
import { destinationPoint } from "../lib/geo";

function aircraftOnApproach(endId: string, finalDistanceM: number): Aircraft {
  const end = RUNWAY_END_BY_ID[endId];
  // Sit on the extended centreline, before the threshold, tracking toward it.
  const reverse = (end.bearingDeg + 180) % 360;
  const pos = destinationPoint(end.threshold, reverse, finalDistanceM);
  return {
    hex: "abc123",
    flight: "SWR1LH",
    lat: pos.lat,
    lon: pos.lon,
    altFt: 2500,
    onGround: false,
    gs: 140,
    track: end.bearingDeg,
    seenPos: 1,
  };
}

describe("assignRunway", () => {
  it("attributes an aircraft on 3 km final to the correct runway end", () => {
    for (const endId of ["28", "10", "16", "34", "14", "32"]) {
      const a = assignRunway(aircraftOnApproach(endId, 3000));
      expect(a?.end, `end ${endId}`).toBe(endId);
      expect(a?.phase).toBe("approach");
    }
  });

  it("does not attribute an aircraft flying the wrong way down the corridor", () => {
    const end = RUNWAY_END_BY_ID["28"];
    const onApproach = aircraftOnApproach("28", 3000);
    // Same position, but tracking the opposite direction (toward 10, not 28).
    const wrongWay: Aircraft = { ...onApproach, track: (end.bearingDeg + 180) % 360 };
    const result = assignRunway(wrongWay);
    expect(result?.end).not.toBe("28");
  });

  it("ignores high-altitude overflights", () => {
    const overflight = aircraftOnApproach("16", 3000);
    overflight.altFt = 20000;
    expect(assignRunway(overflight)).toBeNull();
  });

  it("ignores aircraft far from every runway", () => {
    const far: Aircraft = {
      hex: "zzz999",
      flight: null,
      lat: 47.9,
      lon: 9.2,
      altFt: 3000,
      onGround: false,
      gs: 200,
      track: 90,
      seenPos: 1,
    };
    expect(assignRunway(far)).toBeNull();
  });

  it("ignores aircraft with no track information", () => {
    const noTrack = aircraftOnApproach("28", 3000);
    noTrack.track = null;
    expect(assignRunway(noTrack)).toBeNull();
  });
});
