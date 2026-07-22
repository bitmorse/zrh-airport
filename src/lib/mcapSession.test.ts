// @vitest-environment node
import { McapStreamReader } from "@mcap/core";
import { describe, expect, it } from "vitest";
import type { Aircraft } from "../data/adsb";
import { buildFlightStates, type PollFrame } from "../domain/flightState";
import { buildSessionMcap } from "./mcapSession";

const ac = (hex: string, over: Partial<Aircraft> = {}): Aircraft =>
  ({
    hex,
    lat: 47,
    lon: 8,
    onGround: false,
    altFt: 2000,
    altGeomFt: 2100,
    gs: 150,
    track: 280,
    verticalRateFpm: -500,
    flight: hex.toUpperCase(),
    type: "A320",
    ...over,
  }) as Aircraft;

function frame(t: number, raw: Aircraft[]): PollFrame {
  const { flights } = buildFlightStates(
    raw.map((a) => ({ ac: a, assignment: null })),
    [],
    [],
    1000,
    0,
  );
  return { t, provider: "adsb.lol", raw, flights };
}

interface Msg {
  topic: string;
  schema: string;
  logTime: bigint;
  json: Record<string, unknown>;
}

async function readMcap(blob: Blob): Promise<Msg[]> {
  const reader = new McapStreamReader();
  reader.append(new Uint8Array(await blob.arrayBuffer()));
  const schemaNames = new Map<number, string>();
  const chanSchema = new Map<number, number>();
  const topics = new Map<number, string>();
  const messages: Msg[] = [];
  const dec = new TextDecoder();
  let rec;
  while ((rec = reader.nextRecord())) {
    if (rec.type === "Schema") schemaNames.set(rec.id, rec.name);
    else if (rec.type === "Channel") {
      topics.set(rec.id, rec.topic);
      chanSchema.set(rec.id, rec.schemaId);
    } else if (rec.type === "Message") {
      messages.push({
        topic: topics.get(rec.channelId)!,
        schema: schemaNames.get(chanSchema.get(rec.channelId)!)!,
        logTime: rec.logTime,
        json: JSON.parse(dec.decode(rec.data)),
      });
    }
  }
  return messages;
}

describe("buildSessionMcap", () => {
  it("writes raw + derived channels for each poll on one timeline", async () => {
    const messages = await readMcap(
      await buildSessionMcap([frame(1000, [ac("a")]), frame(5000, [ac("a"), ac("b")])]),
    );
    const raw = messages.filter((m) => m.topic === "/adsb/raw");
    const der = messages.filter((m) => m.topic === "/flights");

    expect(raw).toHaveLength(2);
    expect(der).toHaveLength(2);
    expect(raw[0].schema).toBe("zrh.AdsbSnapshot");
    expect(der[0].schema).toBe("zrh.FlightStates");

    // Second frame carries both aircraft on both channels.
    expect(raw[1].json.count).toBe(2);
    expect(der[1].json.flights).toHaveLength(2);

    // Raw preserves the fields needed to re-run the pipeline (incl. GNSS altitude).
    const first = (raw[0].json.aircraft as Record<string, unknown>[])[0];
    expect(first.hex).toBe("a");
    expect(first.alt_geom_ft).toBe(2100);

    // Derived state is present and joined (aglFt computed once upstream).
    const derFirst = (der[0].json.flights as Record<string, unknown>[])[0];
    expect(derFirst.hex).toBe("a");
    expect(derFirst.agl_ft).toBe(1100); // altGeom 2100 - field 1000 - geoid 0, rounded

    // Raw and derived share the timestamp; frames are time-ordered.
    expect(raw[0].logTime).toBe(der[0].logTime);
    expect(raw[0].logTime < raw[1].logTime).toBe(true);
  });

  it("sorts frames by time regardless of input order", async () => {
    const messages = await readMcap(
      await buildSessionMcap([frame(9000, [ac("x")]), frame(1000, [ac("y")])]),
    );
    const raw = messages.filter((m) => m.topic === "/adsb/raw");
    expect((raw[0].json.aircraft as Record<string, unknown>[])[0].hex).toBe("y");
  });
});
