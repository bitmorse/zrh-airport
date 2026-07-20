import { describe, expect, it } from "vitest";
import { detectMovements, MOVEMENT_COOLDOWN_MS } from "./movements";

const arr = (hex: string, etaSeconds: number) => ({ hex, end: "28", etaSeconds });
const dep = (hex: string, phase: "holding" | "roll" | "climb") => ({ hex, end: "16", phase });

describe("detectMovements", () => {
  it("counts a landing when an arrival reaches the runway (eta 0) and a takeoff on climb", () => {
    const counted = new Map<string, number>();
    const out = detectMovements(
      [arr("a1", 90), arr("a2", 0)],
      [dep("d1", "holding"), dep("d2", "climb")],
      counted,
      1000,
    );
    expect(out.map((m) => `${m.kind}:${m.hex}`).sort()).toEqual(["landing:a2", "takeoff:d2"]);
    expect(out.every((m) => m.ts === 1000)).toBe(true);
  });

  it("counts each movement once across polls, then re-arms after the cooldown", () => {
    const counted = new Map<string, number>();
    // Rollout/climb persist across several polls — only the first counts.
    expect(detectMovements([arr("a2", 0)], [], counted, 1000)).toHaveLength(1);
    expect(detectMovements([arr("a2", 0)], [], counted, 5000)).toHaveLength(0);
    expect(detectMovements([arr("a2", 0)], [], counted, 9000)).toHaveLength(0);
    // A later flight on the same airframe, after the cooldown, counts again.
    const later = detectMovements([arr("a2", 0)], [], counted, 1000 + MOVEMENT_COOLDOWN_MS + 1);
    expect(later).toHaveLength(1);
  });

  it("prunes stale de-dup entries so the memory doesn't grow unbounded", () => {
    const counted = new Map<string, number>();
    detectMovements([arr("a1", 0)], [dep("d1", "climb")], counted, 1000);
    expect(counted.size).toBe(2);
    // A much later poll with no movements evicts the expired entries.
    detectMovements([], [], counted, 1000 + MOVEMENT_COOLDOWN_MS + 1);
    expect(counted.size).toBe(0);
  });
});
