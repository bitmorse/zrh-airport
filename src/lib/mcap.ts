import { McapWriter, TempBuffer } from "@mcap/core";
import { relLoudness, type NoiseEvent } from "../data/noiseStore";
import { blobToPcm16 } from "./wav";

/**
 * Export landing-noise measurements as a single MCAP file, fully in-browser.
 * Three timestamped channels share one timeline, openable in Foxglove Studio:
 *   /audio       → foxglove.RawAudio    (decoded PCM per clip; Audio panel)
 *   /gps         → foxglove.LocationFix (where it was measured)
 *   /measurement → zrh.NoiseMeasurement (aircraft, runway, loudness, duration)
 *
 * Messages use JSON encoding with jsonschema so no protobuf toolchain is needed;
 * audio bytes are base64 (larger than protobuf, but dependency-free).
 */

const timeSchema = {
  type: "object",
  properties: { sec: { type: "integer" }, nsec: { type: "integer" } },
};

const RAW_AUDIO_SCHEMA = {
  type: "object",
  title: "foxglove.RawAudio",
  properties: {
    timestamp: timeSchema,
    data: { type: "string", contentEncoding: "base64" },
    format: { type: "string" },
    sample_rate: { type: "integer" },
    number_of_channels: { type: "integer" },
  },
};

const LOCATION_FIX_SCHEMA = {
  type: "object",
  title: "foxglove.LocationFix",
  properties: {
    timestamp: timeSchema,
    frame_id: { type: "string" },
    latitude: { type: "number" },
    longitude: { type: "number" },
    altitude: { type: "number" },
  },
};

const MEASUREMENT_SCHEMA = {
  type: "object",
  title: "zrh.NoiseMeasurement",
  properties: {
    callsign: { type: "string" },
    hex: { type: "string" },
    runway: { type: "string" },
    peak_rel: { type: "integer" },
    peak_dbfs: { type: "number" },
    avg_dbfs: { type: "number" },
    duration_s: { type: "number" },
    latitude: { type: "number" },
    longitude: { type: "number" },
  },
};

const enc = new TextEncoder();
const json = (obj: unknown): Uint8Array => enc.encode(JSON.stringify(obj));
const nsBig = (ms: number): bigint => BigInt(Math.round(ms)) * 1_000_000n;
const toTime = (ms: number) => ({
  sec: Math.floor(ms / 1000),
  nsec: Math.round((ms % 1000) * 1e6),
});
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Base64-encode bytes in chunks (avoids call-stack limits on big buffers). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function buildNoiseMcap(
  events: NoiseEvent[],
  loadAudio: (id: string) => Promise<Blob | undefined>,
): Promise<Blob> {
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
    return writer.registerChannel({
      schemaId,
      topic,
      messageEncoding: "json",
      metadata: new Map(),
    });
  };

  const audioCh = await register("foxglove.RawAudio", RAW_AUDIO_SCHEMA, "/audio");
  const gpsCh = await register("foxglove.LocationFix", LOCATION_FIX_SCHEMA, "/gps");
  const measCh = await register("zrh.NoiseMeasurement", MEASUREMENT_SCHEMA, "/measurement");

  let sequence = 0;
  const add = async (channelId: number, logTime: bigint, obj: unknown) => {
    await writer.addMessage({
      channelId,
      sequence: sequence++,
      logTime,
      publishTime: logTime,
      data: json(obj),
    });
  };

  const sorted = [...events].sort((a, b) => a.startedAt - b.startedAt);
  for (const e of sorted) {
    const logTime = nsBig(e.startedAt);
    const t = toTime(e.startedAt);

    await add(measCh, logTime, {
      callsign: e.callsign ?? "",
      hex: e.hex ?? "",
      runway: e.runwayEnd ?? "",
      peak_rel: relLoudness(e.peakDbfs),
      peak_dbfs: round1(e.peakDbfs),
      avg_dbfs: round1(e.avgDbfs),
      duration_s: round1(e.durationMs / 1000),
      latitude: e.lat,
      longitude: e.lon,
    });

    if (e.lat != null && e.lon != null) {
      await add(gpsCh, logTime, {
        timestamp: t,
        frame_id: "gps",
        latitude: e.lat,
        longitude: e.lon,
        altitude: 0,
      });
    }

    if (e.hasAudio) {
      const blob = await loadAudio(e.id);
      if (blob) {
        try {
          const pcm = await blobToPcm16(blob);
          await add(audioCh, logTime, {
            timestamp: t,
            data: bytesToBase64(pcm.data),
            format: "pcm-s16",
            sample_rate: pcm.sampleRate,
            number_of_channels: pcm.channels,
          });
        } catch {
          /* undecodable clip — skip audio, keep the measurement */
        }
      }
    }
  }

  await writer.end();
  const bytes = buffer.get();
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return new Blob([out], { type: "application/octet-stream" });
}
