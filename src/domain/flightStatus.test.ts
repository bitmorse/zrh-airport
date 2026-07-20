import { describe, expect, it } from "vitest";
import type { RunwayAssignment } from "./assignRunway";
import type { DepartureEvent } from "./departures";
import { flightStatusLabel } from "./flightStatus";
import type { Arrival } from "./predictions";

const dep = (phase: DepartureEvent["phase"]): DepartureEvent => ({
  end: "16",
  strip: "16/34",
  hex: "x",
  callsign: "X",
  phase,
  gsKt: 0,
});
const arr = (etaSeconds: number): Arrival => ({
  end: "28",
  strip: "10/28",
  hex: "x",
  callsign: "X",
  etaSeconds,
  distanceNm: 2,
  gsKt: 140,
});
const assign = (phase: RunwayAssignment["phase"]): RunwayAssignment =>
  ({ end: "14", strip: "14/32", phase }) as RunwayAssignment;

describe("flightStatusLabel", () => {
  it("labels departure phases (highest priority)", () => {
    expect(flightStatusLabel({ ac: { onGround: true, gs: 0 }, departure: dep("holding") })).toEqual({
      label: "waiting",
      rwy: "16",
    });
    expect(flightStatusLabel({ ac: { onGround: true, gs: 60 }, departure: dep("roll") }).label).toBe(
      "cleared for takeoff",
    );
    expect(flightStatusLabel({ ac: { onGround: false, gs: 160 }, departure: dep("climb") }).label).toBe(
      "climbing out",
    );
  });

  it("reads a just-touched-down arrival (eta 0, on ground) as 'just landed'", () => {
    expect(flightStatusLabel({ ac: { onGround: true, gs: 95 }, arrival: arr(0) })).toEqual({
      label: "just landed",
      rwy: "28",
    });
  });

  it("reads an airborne arrival at the threshold as 'landing', earlier as 'on approach'", () => {
    expect(flightStatusLabel({ ac: { onGround: false, gs: 140 }, arrival: arr(0) }).label).toBe("landing");
    expect(flightStatusLabel({ ac: { onGround: false, gs: 150 }, arrival: arr(120) }).label).toBe(
      "on approach",
    );
  });

  it("falls back to the runway assignment phase", () => {
    expect(flightStatusLabel({ ac: { onGround: false, gs: 150 }, assignment: assign("approach") }).label).toBe(
      "on approach",
    );
    expect(flightStatusLabel({ ac: { onGround: true, gs: 80 }, assignment: assign("runway") }).label).toBe(
      "on the runway",
    );
  });

  it("describes ground state instead of 'in range' when there's no record", () => {
    expect(flightStatusLabel({ ac: { onGround: true, gs: 15 } }).label).toBe("taxiing");
    expect(flightStatusLabel({ ac: { onGround: true, gs: 0 } }).label).toBe("on the ground");
  });

  it("returns null (motion only, no 'in range') for an unrelated airborne aircraft", () => {
    expect(flightStatusLabel({ ac: { onGround: false, gs: 400 } })).toEqual({ label: null });
  });
});
