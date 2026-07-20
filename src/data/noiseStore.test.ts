import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory idb-keyval so the store's read-modify-write persists within the test.
const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  del: vi.fn(async (k: string) => void store.delete(k)),
}));

import {
  addNoiseEvent,
  getNoiseSnapshot,
  relabelNoiseEvent,
  type NoiseCandidate,
  type NoiseEvent,
} from "./noiseStore";

function candidate(hex: string, over: Partial<NoiseCandidate> = {}): NoiseCandidate {
  return {
    hex,
    callsign: hex.toUpperCase(),
    aircraftType: "A320",
    aircraftTypeDesc: "AIRBUS A-320",
    registration: `REG-${hex}`,
    closestApproachM: 500,
    track: [{ t: 1, lat: 47.4, lon: 8.5, alt: 900, distanceM: 500 }],
    closest: {
      t: 1,
      gsKt: 140,
      altFt: 900,
      trackDeg: 280,
      verticalRateFpm: -600,
      acLat: 47.41,
      acLon: 8.51,
    },
    ...over,
  };
}

const EVENT: NoiseEvent = {
  id: "evt1",
  hex: "near",
  callsign: "NEAR",
  runwayEnd: "28",
  kind: "arrival",
  geofenceRadiusM: null,
  aircraftType: "A320",
  aircraftTypeDesc: "AIRBUS A-320",
  registration: "REG-near",
  gsKt: 140,
  altFt: 900,
  track: 280,
  verticalRateFpm: -600,
  acLat: 47.41,
  acLon: 8.51,
  heldSeconds: null,
  lat: 47.46,
  lon: 8.55,
  peakDbfs: -12,
  avgDbfs: -20,
  startedAt: 1_700_000_000_000,
  durationMs: 30_000,
  hasAudio: false,
  primaryHex: "near",
  candidates: [
    candidate("near", { closestApproachM: 300 }),
    candidate("other", { closestApproachM: 1200, callsign: "OTHER" }),
  ],
};

beforeEach(() => store.clear());

describe("relabelNoiseEvent", () => {
  it("rewrites the primary fields from the chosen candidate, keeping kind/runway", async () => {
    await addNoiseEvent(structuredClone(EVENT), null);

    await relabelNoiseEvent("evt1", "other");

    const e = getNoiseSnapshot().find((x) => x.id === "evt1")!;
    expect(e.hex).toBe("other");
    expect(e.primaryHex).toBe("other");
    expect(e.callsign).toBe("OTHER");
    expect(e.registration).toBe("REG-other");
    expect(e.acLat).toBe(47.41);
    // Trigger classification is independent of the label.
    expect(e.kind).toBe("arrival");
    expect(e.runwayEnd).toBe("28");
    // Persisted, not just in memory.
    const { set } = await import("idb-keyval");
    expect(set).toHaveBeenCalledWith(
      "zrh:noise:events",
      expect.arrayContaining([expect.objectContaining({ id: "evt1", hex: "other" })]),
    );
  });

  it("is a no-op for an unknown candidate hex", async () => {
    await addNoiseEvent(structuredClone(EVENT), null);
    await relabelNoiseEvent("evt1", "ghost");
    expect(getNoiseSnapshot().find((x) => x.id === "evt1")!.hex).toBe("near");
  });
});
