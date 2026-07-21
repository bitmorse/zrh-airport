import { describe, expect, it } from "vitest";
import type { DepartureEvent, DeparturePhase } from "./departures";
import type { Arrival } from "./predictions";
import { buildQueues, QUEUE } from "./queue";

const arr = (hex: string, etaSeconds: number): Arrival => ({
  end: "14",
  strip: "14/32",
  hex,
  callsign: hex.toUpperCase(),
  etaSeconds,
  distanceNm: etaSeconds / 60,
  gsKt: 140,
});

const dep = (
  hex: string,
  phase: DeparturePhase,
  extra: Partial<DepartureEvent> = {},
): DepartureEvent => ({
  end: "28",
  strip: "10/28",
  hex,
  callsign: hex.toUpperCase(),
  phase,
  gsKt: phase === "holding" ? 0 : 60,
  ...extra,
});

const hexes = <T extends { hex: string }>(list: T[]) => list.map((i) => i.hex);

describe("buildQueues — arrivals", () => {
  it("keeps arrivals within the horizon, soonest-first order preserved", () => {
    const arrivals = [arr("a1", 60), arr("a2", 300), arr("a3", QUEUE.arrivalHorizonS + 1)];
    const q = buildQueues({ arrivals, departures: [] });
    expect(hexes(q.arrivals)).toEqual(["a1", "a2"]); // a3 is past the horizon
    expect(q.arrivalsMore).toBe(0);
  });

  it("caps arrivals at maxRows and reports the overflow", () => {
    const arrivals = Array.from({ length: QUEUE.maxRows + 3 }, (_, i) => arr(`a${i}`, i * 10 + 10));
    const q = buildQueues({ arrivals, departures: [] });
    expect(q.arrivals).toHaveLength(QUEUE.maxRows);
    expect(q.arrivalsMore).toBe(3);
  });
});

describe("buildQueues — departure lineup (FIFO)", () => {
  it("orders roll → holding-by-wait → climb, longest wait leading", () => {
    const departures = [
      dep("climb1", "climb", { gsKt: 160 }),
      dep("hold_new", "holding", { holdingSinceMs: 5_000 }), // shorter wait
      dep("roll1", "roll", { gsKt: 90 }),
      dep("hold_old", "holding", { holdingSinceMs: 1_000 }), // longer wait → ahead
    ];
    const q = buildQueues({ arrivals: [], departures });
    expect(hexes(q.departures)).toEqual(["roll1", "hold_old", "hold_new", "climb1"]);
  });

  it("caps departures at maxRows and reports the overflow", () => {
    const departures = Array.from({ length: QUEUE.maxRows + 2 }, (_, i) =>
      dep(`d${i}`, "holding", { holdingSinceMs: i }),
    );
    const q = buildQueues({ arrivals: [], departures });
    expect(q.departures).toHaveLength(QUEUE.maxRows);
    expect(q.departuresMore).toBe(2);
  });
});

describe("buildQueues — selection visibility", () => {
  it("rescues a selected departure beyond the cap and decrements the overflow", () => {
    const departures = Array.from({ length: QUEUE.maxRows + 2 }, (_, i) =>
      dep(`d${i}`, "holding", { holdingSinceMs: i }),
    );
    const last = `d${QUEUE.maxRows + 1}`;
    const q = buildQueues({ arrivals: [], departures, selectedHex: last });
    expect(hexes(q.departures)).toContain(last);
    expect(q.departures).toHaveLength(QUEUE.maxRows + 1); // cap + the rescued row
    expect(q.departuresMore).toBe(1); // one still hidden
    expect(q.orphanHex).toBeNull();
  });

  it("rescues a selected arrival that is past the horizon (not an orphan)", () => {
    const arrivals = [arr("near", 120), arr("far", QUEUE.arrivalHorizonS + 500)];
    const q = buildQueues({ arrivals, departures: [], selectedHex: "far" });
    expect(hexes(q.arrivals)).toContain("far");
    expect(q.orphanHex).toBeNull();
  });

  it("returns orphanHex for a selection in neither queue", () => {
    const q = buildQueues({
      arrivals: [arr("a1", 60)],
      departures: [dep("d1", "holding", { holdingSinceMs: 0 })],
      selectedHex: "wander",
    });
    expect(q.orphanHex).toBe("wander");
  });

  it("no orphan when the selection is a normally-shown row", () => {
    const q = buildQueues({ arrivals: [arr("a1", 60)], departures: [], selectedHex: "a1" });
    expect(q.orphanHex).toBeNull();
  });
});
