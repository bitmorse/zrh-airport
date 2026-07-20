import { describe, expect, it, vi } from "vitest";

// idb-keyval needs IndexedDB (absent in jsdom); back it with an in-memory map.
vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: unknown) => {
      store.set(k, v);
    },
    del: async (k: string) => {
      store.delete(k);
    },
  };
});

import {
  addWatch,
  getWatchedSnapshot,
  removeWatch,
  totalPoints,
  type WatchedFlight,
} from "./watchStore";

const wf = (id: string, points: 1 | 2): WatchedFlight => ({
  id,
  hex: `hex${id}`,
  callsign: `SWR${id}`,
  type: "A320",
  registration: null,
  kind: "landing",
  end: "28",
  completedAt: 1000,
  points,
  hadGpsAudio: points === 2,
  trajectory: [],
});

describe("watchStore", () => {
  it("adds newest-first, sums points (double counts once), and removes", async () => {
    await addWatch(wf("1", 1));
    await addWatch(wf("2", 2));
    let snap = getWatchedSnapshot();
    expect(snap.map((w) => w.id)).toEqual(["2", "1"]); // newest first
    expect(totalPoints(snap)).toBe(3); // 1 + 2

    await removeWatch("1");
    snap = getWatchedSnapshot();
    expect(snap.map((w) => w.id)).toEqual(["2"]);
    expect(totalPoints(snap)).toBe(2);
  });
});
