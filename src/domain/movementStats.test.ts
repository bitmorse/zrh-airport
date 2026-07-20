import { describe, expect, it } from "vitest";
import type { Movement } from "./movements";
import {
  applyMovements,
  byRunway,
  hasActivity,
  localHour,
  pruneLog,
  recentActivityByEnd,
  summarize,
  type MovementLog,
  type RunwayHistogram,
} from "./movementStats";

const mv = (kind: Movement["kind"], end: string, ts: number): Movement => ({
  kind,
  hex: "x",
  end,
  ts,
});

describe("localHour", () => {
  it("resolves the airport-local date and hour, not the viewer's", () => {
    const ts = Date.UTC(2026, 6, 20, 12, 0, 0); // 2026-07-20 12:00Z
    expect(localHour(ts, "Europe/Zurich")).toEqual({ date: "2026-07-20", hour: 14 }); // CEST +2
    expect(localHour(ts, "Asia/Bangkok")).toEqual({ date: "2026-07-20", hour: 19 }); // +7
  });
});

describe("applyMovements", () => {
  it("buckets movements by local hour AND runway end, and is immutable", () => {
    const before: MovementLog = {};
    const t14 = Date.UTC(2026, 6, 20, 14, 30);
    const after = applyMovements(
      before,
      [mv("landing", "28", t14), mv("landing", "28", t14), mv("takeoff", "16", t14)],
      "UTC",
    );
    expect(after).toEqual({
      "2026-07-20T14": { "28": { l: 2, t: 0 }, "16": { l: 0, t: 1 } },
    });
    expect(before).toEqual({}); // pure — original untouched
  });
});

describe("byRunway", () => {
  const log: MovementLog = {
    "2026-07-20T14": { "28": { l: 2, t: 1 }, "16": { l: 0, t: 3 } },
    "2026-07-21T14": { "28": { l: 0, t: 3 } },
    "2026-07-20T09": { "28": { l: 1, t: 0 } },
  };

  it("produces one 24-hour histogram per runway, busiest first", () => {
    const rws = byRunway(log);
    expect(rws.map((r) => r.end)).toEqual(["28", "16"]); // 28 has more movements
    const rw28 = rws[0];
    expect(rw28.hours).toHaveLength(24);
    expect(rw28.hours[14]).toEqual({ hour: 14, landings: 2, takeoffs: 4, days: 2 });
    expect(rw28.hours[9]).toEqual({ hour: 9, landings: 1, takeoffs: 0, days: 1 });
    expect(rw28).toMatchObject({ landings: 3, takeoffs: 4, days: 2 });
    // 16 only appears in one bucket.
    expect(rws[1]).toMatchObject({ end: "16", landings: 0, takeoffs: 3, days: 1 });
  });
});

describe("recentActivityByEnd", () => {
  const hist = (end: string, byHour: Record<number, { l: number; t: number }>): RunwayHistogram => ({
    end,
    landings: 0,
    takeoffs: 0,
    days: 1,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      landings: byHour[hour]?.l ?? 0,
      takeoffs: byHour[hour]?.t ?? 0,
      days: 1,
    })),
  });

  it("sums the current + previous local hour's movements per end", () => {
    const now = Date.UTC(2026, 6, 20, 14, 30); // local hour 14 in UTC; previous = 13
    const runways = [
      hist("28", { 14: { l: 5, t: 2 }, 13: { l: 3, t: 0 } }), // 5+2+3 = 10
      hist("16", { 14: { l: 0, t: 1 }, 11: { l: 9, t: 9 } }), // only hour 14 counts → 1
    ];
    expect(recentActivityByEnd(runways, now, "UTC")).toEqual({ "28": 10, "16": 1 });
  });

  it("wraps to hour 23 just after local midnight", () => {
    const now = Date.UTC(2026, 6, 20, 0, 10); // local hour 0 → previous = 23
    const runways = [hist("34", { 0: { l: 1, t: 0 }, 23: { l: 4, t: 2 } })];
    expect(recentActivityByEnd(runways, now, "UTC")).toEqual({ "34": 7 });
  });
});

describe("hasActivity", () => {
  it("is true only when some end has a positive count", () => {
    expect(hasActivity({ "28": 0, "16": 0 })).toBe(false);
    expect(hasActivity({})).toBe(false);
    expect(hasActivity({ "28": 0, "16": 3 })).toBe(true);
  });
});

describe("summarize", () => {
  it("totals landings, takeoffs and distinct days across all runways", () => {
    const log: MovementLog = {
      "2026-07-20T14": { "28": { l: 2, t: 1 }, "16": { l: 0, t: 3 } },
      "2026-07-21T14": { "28": { l: 0, t: 3 } },
    };
    expect(summarize(log)).toEqual({ days: 2, landings: 2, takeoffs: 7 });
  });
});

describe("pruneLog", () => {
  it("drops buckets older than the retention window, keeps recent ones", () => {
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);
    const log: MovementLog = {
      "2026-01-01T10": { "28": { l: 5, t: 5 } }, // ~6 months old
      "2026-07-19T08": { "16": { l: 1, t: 2 } }, // yesterday
    };
    expect(pruneLog(log, now, "UTC")).toEqual({ "2026-07-19T08": { "16": { l: 1, t: 2 } } });
  });
});
