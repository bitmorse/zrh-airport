import { McapWriter, TempBuffer } from "@mcap/core";
import type { Aircraft } from "../data/adsb";
import type { FlightState, PollFrame } from "../domain/flightState";

/**
 * Export a session recording — the raw ADS-B feed and the derived flight state for the
 * last few minutes of polls — as one MCAP on a shared timeline, openable in Foxglove:
 *   /adsb/raw → zrh.AdsbSnapshot  (the normalized feed exactly as received, per poll)
 *   /flights  → zrh.FlightStates  (what the pipeline made of it, per poll)
 *
 * Having both channels at the same timestamps is the debug payoff: you can see the raw
 * inputs and the derived outputs side by side and pinpoint where an estimate went wrong.
 * Messages are JSON so no protobuf toolchain is needed; the raw channel is complete enough
 * to re-run the pipeline offline.
 */

const enc = new TextEncoder();
const json = (obj: unknown): Uint8Array => enc.encode(JSON.stringify(obj));
const nsBig = (ms: number): bigint => BigInt(Math.round(ms)) * 1_000_000n;
const toTime = (ms: number) => ({ sec: Math.floor(ms / 1000), nsec: Math.round((ms % 1000) * 1e6) });

const timeSchema = {
  type: "object",
  properties: { sec: { type: "integer" }, nsec: { type: "integer" } },
};

const ADSB_SNAPSHOT_SCHEMA = {
  type: "object",
  title: "zrh.AdsbSnapshot",
  properties: {
    timestamp: timeSchema,
    provider: { type: "string" },
    count: { type: "integer" },
    aircraft: { type: "array", items: { type: "object" } },
  },
};

const FLIGHT_STATES_SCHEMA = {
  type: "object",
  title: "zrh.FlightStates",
  properties: {
    timestamp: timeSchema,
    count: { type: "integer" },
    flights: { type: "array", items: { type: "object" } },
  },
};

/** The raw feed fields worth recording (enough to re-derive the pipeline offline). */
function rawLite(a: Aircraft) {
  return {
    hex: a.hex,
    flight: a.flight ?? null,
    type: a.type ?? null,
    lat: a.lat,
    lon: a.lon,
    alt_ft: a.altFt,
    alt_geom_ft: a.altGeomFt,
    gs_kt: a.gs ?? null,
    track_deg: a.track ?? null,
    vrate_fpm: a.verticalRateFpm ?? null,
    on_ground: a.onGround,
  };
}

/** The derived per-aircraft state, flattened for inspection. */
function flightLite(f: FlightState) {
  return {
    hex: f.hex,
    phase: f.assignment?.phase ?? null,
    active: f.active,
    agl_ft: Math.round(f.aglFt),
    heading: f.heading,
    label: f.status.label,
    rwy: f.status.rwy ?? null,
    arrival_eta_s: f.arrival?.etaSeconds ?? null,
    departure_phase: f.departure?.phase ?? null,
  };
}

export async function buildSessionMcap(frames: PollFrame[]): Promise<Blob> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({
    writable: buffer,
    useChunks: true,
    useStatistics: true,
    useChunkIndex: true,
    useMessageIndex: true,
  });
  await writer.start({ profile: "", library: "zrh-airport" });

  const register = async (name: string, schema: unknown, topic: string) => {
    const schemaId = await writer.registerSchema({
      name,
      encoding: "jsonschema",
      data: json(schema),
    });
    return writer.registerChannel({ schemaId, topic, messageEncoding: "json", metadata: new Map() });
  };

  const rawCh = await register("zrh.AdsbSnapshot", ADSB_SNAPSHOT_SCHEMA, "/adsb/raw");
  const flightsCh = await register("zrh.FlightStates", FLIGHT_STATES_SCHEMA, "/flights");

  let sequence = 0;
  const add = async (channelId: number, logTime: bigint, obj: unknown) => {
    await writer.addMessage({ channelId, sequence: sequence++, logTime, publishTime: logTime, data: json(obj) });
  };

  for (const fr of [...frames].sort((a, b) => a.t - b.t)) {
    const logTime = nsBig(fr.t);
    const ts = toTime(fr.t);
    await add(rawCh, logTime, {
      timestamp: ts,
      provider: fr.provider ?? "",
      count: fr.raw.length,
      aircraft: fr.raw.map(rawLite),
    });
    await add(flightsCh, logTime, {
      timestamp: ts,
      count: fr.flights.length,
      flights: fr.flights.map(flightLite),
    });
  }

  await writer.end();
  const bytes = buffer.get();
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return new Blob([out], { type: "application/octet-stream" });
}
