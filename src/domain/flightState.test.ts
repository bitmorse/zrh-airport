import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import type { AircraftWithAssignment } from "../hooks/useLiveTraffic";
import type { RunwayAssignment } from "./assignRunway";
import type { DepartureEvent } from "./departures";
import type { Arrival } from "./predictions";
import { buildFlightStates } from "./flightState";

const FIELD = 1000;
const GEOID = 0;

function ac(hex: string, over: Partial<Aircraft> = {}): Aircraft {
  return { hex, lat: 47, lon: 8, ...over } as Aircraft;
}

function item(a: Aircraft, assignment: RunwayAssignment | null = null, heading?: number): AircraftWithAssignment {
  return { ac: a, assignment, heading };
}

const arrival = (hex: string, etaSeconds: number): Arrival => ({
  end: "14",
  strip: "14/32",
  hex,
  callsign: hex.toUpperCase(),
  etaSeconds,
  distanceNm: 4,
  gsKt: 140,
});

const holding = (hex: string): DepartureEvent => ({
  end: "28",
  strip: "10/28",
  hex,
  callsign: hex.toUpperCase(),
  phase: "holding",
  gsKt: 0,
  holdingSinceMs: 1_000,
});

const assignment: RunwayAssignment = {
  end: "14",
  strip: "14/32",
  phase: "approach",
  crossTrackM: 10,
  alongTrackM: -5000,
};

describe("buildFlightStates", () => {
  it("joins an arrival by hex and computes status + AGL once", () => {
    const a = ac("arr", { altGeomFt: 2000 }); // airborne
    const { flights, byHex } = buildFlightStates(
      [item(a, assignment)],
      [arrival("arr", 90)],
      [],
      FIELD,
      GEOID,
    );
    const f = byHex.get("arr")!;
    expect(f.arrival?.etaSeconds).toBe(90);
    expect(f.status.label).toBe("on approach");
    expect(f.aglFt).toBe(1000); // 2000 - 1000 field - 0 geoid
    expect(f.active).toBe(true);
    expect(flights).toHaveLength(1);
  });

  it("reads 'landing' / 'just landed' from the arrival at the threshold", () => {
    const air = buildFlightStates([item(ac("x"))], [arrival("x", 0)], [], FIELD, GEOID);
    expect(air.byHex.get("x")!.status.label).toBe("landing");
    const ground = buildFlightStates(
      [item(ac("x", { onGround: true }))],
      [arrival("x", 0)],
      [],
      FIELD,
      GEOID,
    );
    expect(ground.byHex.get("x")!.status.label).toBe("just landed");
    expect(ground.byHex.get("x")!.aglFt).toBe(0); // on ground
  });

  it("joins a departure by hex", () => {
    const { byHex } = buildFlightStates(
      [item(ac("dep", { onGround: true, gs: 0 }))],
      [],
      [holding("dep")],
      FIELD,
      GEOID,
    );
    const f = byHex.get("dep")!;
    expect(f.departure?.phase).toBe("holding");
    expect(f.status.label).toBe("waiting");
  });

  it("gives an unrelated airborne aircraft a null label and inactive", () => {
    const { byHex } = buildFlightStates(
      [item(ac("over", { altGeomFt: 30000 }))],
      [],
      [],
      FIELD,
      GEOID,
    );
    const f = byHex.get("over")!;
    expect(f.status.label).toBeNull();
    expect(f.active).toBe(false);
    expect(f.arrival).toBeNull();
    expect(f.departure).toBeNull();
  });

  it("indexes every aircraft in byHex and carries the glyph heading", () => {
    const { flights, byHex } = buildFlightStates(
      [item(ac("a"), null, 270), item(ac("b"))],
      [],
      [],
      FIELD,
      GEOID,
    );
    expect(byHex.size).toBe(2);
    expect(flights.map((f) => f.hex).sort()).toEqual(["a", "b"]);
    expect(byHex.get("a")!.heading).toBe(270);
    expect(byHex.get("b")!.heading).toBeNull();
  });
});
