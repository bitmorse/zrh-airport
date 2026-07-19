import { describe, expect, it } from "vitest";
import {
  countsByEnd,
  pruneObservations,
  WINDOW_MS,
  type Observation,
} from "./observations";

describe("pruneObservations", () => {
  it("drops entries older than the window and keeps recent ones", () => {
    const now = 1_000_000_000;
    const obs: Observation[] = [
      { hex: "a", end: "28", ts: now }, // fresh
      { hex: "b", end: "28", ts: now - WINDOW_MS + 1 }, // just inside
      { hex: "c", end: "28", ts: now - WINDOW_MS - 1 }, // just outside
      { hex: "d", end: "16", ts: now - 2 * WINDOW_MS }, // way outside
    ];
    const kept = pruneObservations(obs, now);
    expect(kept.map((o) => o.hex).sort()).toEqual(["a", "b"]);
  });
});

describe("countsByEnd", () => {
  it("counts distinct aircraft per runway end", () => {
    const now = 5_000;
    const obs: Observation[] = [
      { hex: "a", end: "28", ts: now },
      { hex: "a", end: "28", ts: now + 1 }, // same aircraft, seen twice
      { hex: "b", end: "28", ts: now + 2 },
      { hex: "c", end: "16", ts: now + 3 },
    ];
    expect(countsByEnd(obs)).toEqual({ "28": 2, "16": 1 });
  });

  it("returns an empty map for no observations", () => {
    expect(countsByEnd([])).toEqual({});
  });
});
