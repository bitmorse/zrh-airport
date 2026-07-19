import { McapWriter, TempBuffer } from "@mcap/core";
import { relLoudness, type NoiseEvent } from "../data/noiseStore";
import { blobToMonoPcm16 } from "./wav";

/**
 * Export landing-noise measurements as a single MCAP file, fully in-browser.
 * Three timestamped channels share one timeline, openable in Foxglove Studio:
 *   /audio       → foxglove.RawAudio    (mono PCM, streamed in ~200 ms blocks
 *                                        so the Audio panel can play it back)
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
    aircraft_type: { type: "string" },
    type_desc: { type: "string" },
    registration: { type: "string" },
    runway: { type: "string" },
    kind: { type: "string" },
    gs_kt: { type: "number" },
    alt_ft: { type: "number" },
    track_deg: { type: "number" },
    vrate_fpm: { type: "number" },
    ac_latitude: { type: "number" },
    ac_longitude: { type: "number" },
    held_s: { type: "number" },
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

/**
 * Foxglove's Audio panel treats each RawAudio message as one "block of an audio
 * bitstream" and plays consecutive blocks against the timeline clock. A whole
 * clip in a single block draws a waveform but won't play, so we slice each clip
 * into short contiguous blocks (~200 ms) whose timestamps advance with the audio.
 */
const AUDIO_BLOCK_MS = 200;

/** Copy mono int16 samples to little-endian bytes for a RawAudio block. */
function int16ToLeBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(new ArrayBuffer(samples.length * 2));
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return bytes;
}

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
      aircraft_type: e.aircraftType ?? "",
      type_desc: e.aircraftTypeDesc ?? "",
      registration: e.registration ?? "",
      runway: e.runwayEnd ?? "",
      kind: e.kind ?? "",
      gs_kt: e.gsKt ?? 0,
      alt_ft: e.altFt ?? 0,
      track_deg: e.track ?? 0,
      vrate_fpm: e.verticalRateFpm ?? 0,
      ac_latitude: e.acLat ?? 0,
      ac_longitude: e.acLon ?? 0,
      held_s: e.heldSeconds ?? 0,
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
          const { samples, sampleRate } = await blobToMonoPcm16(blob);
          const perBlock = Math.max(1, Math.round((sampleRate * AUDIO_BLOCK_MS) / 1000));
          for (let off = 0; off < samples.length; off += perBlock) {
            const block = samples.subarray(off, off + perBlock);
            const blockMs = e.startedAt + (off / sampleRate) * 1000;
            await add(audioCh, nsBig(blockMs), {
              timestamp: toTime(blockMs),
              data: bytesToBase64(int16ToLeBytes(block)),
              format: "pcm-s16",
              sample_rate: sampleRate,
              number_of_channels: 1,
            });
          }
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
