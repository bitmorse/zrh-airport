import { describe, expect, it } from "vitest";
import type { Movement } from "./movements";
import {
  applyMovements,
  hourlyHistogram,
  localHour,
  pruneLog,
  summarize,
  type MovementLog,
} from "./movementStats";

const mv = (kind: Movement["kind"], ts: number): Movement => ({ kind, hex: "x", end: "28", ts });

describe("localHour", () => {
  it("resolves the airport-local date and hour, not the viewer's", () => {
    const ts = Date.UTC(2026, 6, 20, 12, 0, 0); // 2026-07-20 12:00Z
    expect(localHour(ts, "Europe/Zurich")).toEqual({ date: "2026-07-20", hour: 14 }); // CEST +2
    expect(localHour(ts, "Asia/Bangkok")).toEqual({ date: "2026-07-20", hour: 19 }); // +7
  });
});

describe("applyMovements", () => {
  it("buckets landings and takeoffs by local hour and is immutable", () => {
    const before: MovementLog = {};
    const t14 = Date.UTC(2026, 6, 20, 14, 30);
    const after = applyMovements(
      before,
      [mv("landing", t14), mv("landing", t14), mv("takeoff", t14)],
      "UTC",
    );
    expect(after).toEqual({ "2026-07-20T14": { l: 2, t: 1 } });
    expect(before).toEqual({}); // pure — original untouched
  });
});

describe("hourlyHistogram", () => {
  it("aggregates totals and counts distinct days per hour", () => {
    const log: MovementLog = {
      "2026-07-20T14": { l: 2, t: 1 },
      "2026-07-21T14": { l: 0, t: 3 },
      "2026-07-20T09": { l: 1, t: 0 },
    };
    const hist = hourlyHistogram(log);
    expect(hist).toHaveLength(24);
    expect(hist[14]).toEqual({ hour: 14, landings: 2, takeoffs: 4, days: 2 });
    expect(hist[9]).toEqual({ hour: 9, landings: 1, takeoffs: 0, days: 1 });
    expect(hist[0]).toEqual({ hour: 0, landings: 0, takeoffs: 0, days: 0 });
  });
});

describe("summarize", () => {
  it("totals landings, takeoffs and distinct days across the whole log", () => {
    const log: MovementLog = {
      "2026-07-20T14": { l: 2, t: 1 },
      "2026-07-21T14": { l: 0, t: 3 },
      "2026-07-20T09": { l: 1, t: 0 },
    };
    expect(summarize(log)).toEqual({ days: 2, landings: 3, takeoffs: 4 });
  });
});

describe("pruneLog", () => {
  it("drops buckets older than the retention window, keeps recent ones", () => {
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);
    const log: MovementLog = {
      "2026-01-01T10": { l: 5, t: 5 }, // ~6 months old
      "2026-07-19T08": { l: 1, t: 2 }, // yesterday
    };
    expect(pruneLog(log, now, "UTC")).toEqual({ "2026-07-19T08": { l: 1, t: 2 } });
  });
});
