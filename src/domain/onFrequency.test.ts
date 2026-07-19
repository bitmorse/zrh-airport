import { describe, expect, it } from "vitest";
import type { DepartureEvent } from "./departures";
import type { Arrival } from "./predictions";
import { activeRunwayEnds, onFrequencyCandidates } from "./onFrequency";

function arrival(over: Partial<Arrival>): Arrival {
  return {
    end: "28",
    strip: "10/28",
    hex: "a1",
    callsign: "SWR1",
    etaSeconds: 120,
    distanceNm: 6,
    gsKt: 150,
    ...over,
  };
}

function departure(over: Partial<DepartureEvent>): DepartureEvent {
  return {
    end: "34",
    strip: "16/34",
    hex: "d1",
    callsign: "EDW1",
    phase: "roll",
    gsKt: 60,
    ...over,
  };
}

describe("activeRunwayEnds", () => {
  it("unions the ends seen in arrivals and departures", () => {
    const ends = activeRunwayEnds(
      [arrival({ end: "28" }), arrival({ end: "14", hex: "a2" })],
      [departure({ end: "34" })],
    );
    expect(new Set(ends)).toEqual(new Set(["28", "14", "34"]));
  });
});

describe("onFrequencyCandidates", () => {
  it("tower: short finals + all departures, most-imminent first", () => {
    const arrivals = [
      arrival({ hex: "far", etaSeconds: 300 }), // beyond tower's ~4 min
      arrival({ hex: "near", etaSeconds: 40 }),
    ];
    const departures = [
      departure({ hex: "rolling", phase: "roll" }),
      departure({ hex: "waiting", phase: "holding" }),
    ];
    const c = onFrequencyCandidates("tower", arrivals, departures);
    // The distant inbound is Approach's, not Tower's.
    expect(c.find((x) => x.hex === "far")).toBeUndefined();
    // A takeoff roll (rank 0) outranks a 40 s final; holding sits between.
    expect(c.map((x) => x.hex)).toEqual(["rolling", "near", "waiting"]);
  });

  it("approach: every inbound, no departures", () => {
    const c = onFrequencyCandidates(
      "approach",
      [arrival({ hex: "far", etaSeconds: 300 }), arrival({ hex: "near", etaSeconds: 40 })],
      [departure({ phase: "roll" })],
    );
    expect(c.every((x) => x.kind === "arrival")).toBe(true);
    expect(c.map((x) => x.hex)).toEqual(["near", "far"]); // soonest first
  });

  it("departure: climb-outs and rolls only; ground: holds only", () => {
    const deps = [
      departure({ hex: "roll", phase: "roll" }),
      departure({ hex: "climb", phase: "climb" }),
      departure({ hex: "hold", phase: "holding" }),
    ];
    const dep = onFrequencyCandidates("departure", [], deps).map((x) => x.hex);
    expect(dep).toEqual(["roll", "climb"]);
    const gnd = onFrequencyCandidates("ground", [arrival({})], deps).map((x) => x.hex);
    expect(gnd).toEqual(["hold"]); // no arrivals, only holding departures
  });
});
