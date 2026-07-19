import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { assignRunway } from "./assignRunway";
import { ZRH } from "../data/airports";
import { buildAirport } from "./airport";
import { destinationPoint } from "../lib/geo";

const AP = buildAirport(ZRH);

function aircraftOnApproach(endId: string, finalDistanceM: number): Aircraft {
  const end = AP.endById[endId];
  // Sit on the extended centreline, before the threshold, tracking toward it.
  const reverse = (end.bearingDeg + 180) % 360;
  const pos = destinationPoint(end.threshold, reverse, finalDistanceM);
  return {
    hex: "abc123",
    flight: "SWR1LH",
    lat: pos.lat,
    lon: pos.lon,
    altFt: 2500,
    altGeomFt: null,
    onGround: false,
    gs: 140,
    track: end.bearingDeg,
    verticalRateFpm: -700,
    seenPos: 1,
    type: null,
    typeDesc: null,
    registration: null,
  };
}

describe("assignRunway", () => {
  it("attributes an aircraft on 3 km final to the correct runway end", () => {
    for (const endId of ["28", "10", "16", "34", "14", "32"]) {
      const a = assignRunway(AP, aircraftOnApproach(endId, 3000));
      expect(a?.end, `end ${endId}`).toBe(endId);
      expect(a?.phase).toBe("approach");
    }
  });

  it("does not attribute an aircraft flying the wrong way down the corridor", () => {
    const end = AP.endById["28"];
    const onApproach = aircraftOnApproach("28", 3000);
    // Same position, but tracking the opposite direction (toward 10, not 28).
    const wrongWay: Aircraft = { ...onApproach, track: (end.bearingDeg + 180) % 360 };
    const result = assignRunway(AP, wrongWay);
    expect(result?.end).not.toBe("28");
  });

  it("ignores slow taxiing aircraft near a runway", () => {
    const taxi = aircraftOnApproach("28", 500);
    taxi.gs = 15; // taxi speed
    expect(assignRunway(AP, taxi)).toBeNull();
  });

  it("ignores high-altitude overflights", () => {
    const overflight = aircraftOnApproach("16", 3000);
    overflight.altFt = 20000;
    expect(assignRunway(AP, overflight)).toBeNull();
  });

  it("ignores aircraft far from every runway", () => {
    const far: Aircraft = {
      hex: "zzz999",
      flight: null,
      lat: 47.9,
      lon: 9.2,
      altFt: 3000,
      altGeomFt: null,
      onGround: false,
      gs: 200,
      track: 90,
      verticalRateFpm: null,
      seenPos: 1,
      type: null,
      typeDesc: null,
      registration: null,
    };
    expect(assignRunway(AP, far)).toBeNull();
  });

  it("ignores aircraft with no track information", () => {
    const noTrack = aircraftOnApproach("28", 3000);
    noTrack.track = null;
    expect(assignRunway(AP, noTrack)).toBeNull();
  });
});
