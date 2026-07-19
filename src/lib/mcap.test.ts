// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { McapStreamReader } from "@mcap/core";

// The audio path decodes a Blob via Web Audio (browser-only). Mock it with a
// deterministic mono ramp so we can verify the RawAudio blocking is correct.
const SAMPLE_RATE = 48000;
const CLIP_SAMPLES = 30000; // 0.625 s → several 200 ms blocks
vi.mock("./wav", () => ({
  blobToMonoPcm16: vi.fn(async () => {
    const samples = new Int16Array(CLIP_SAMPLES);
    for (let i = 0; i < samples.length; i++) samples[i] = ((i % 200) - 100) * 100;
    return { samples, sampleRate: SAMPLE_RATE };
  }),
}));

import { buildNoiseMcap } from "./mcap";
import type { NoiseEvent } from "../data/noiseStore";

function event(overrides: Partial<NoiseEvent>): NoiseEvent {
  return {
    id: "e1",
    hex: "abc123",
    callsign: "SWR40L",
    runwayEnd: "28",
    kind: "arrival",
    heldSeconds: null,
    lat: 47.45,
    lon: 8.57,
    peakDbfs: -12,
    avgDbfs: -20,
    startedAt: 1_700_000_000_000,
    durationMs: 625,
    hasAudio: true,
    ...overrides,
  };
}

interface ReadBack {
  topics: Map<number, string>;
  schemaByChannel: Map<number, string>;
  messages: { topic: string; schema: string; logTime: bigint; json: unknown }[];
}

async function readMcap(blob: Blob): Promise<ReadBack> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const reader = new McapStreamReader();
  reader.append(bytes);
  const schemaNames = new Map<number, string>();
  const chanSchema = new Map<number, number>();
  const topics = new Map<number, string>();
  const schemaByChannel = new Map<number, string>();
  const messages: ReadBack["messages"] = [];
  const dec = new TextDecoder();
  let rec;
  while ((rec = reader.nextRecord())) {
    if (rec.type === "Schema") schemaNames.set(rec.id, rec.name);
    else if (rec.type === "Channel") {
      topics.set(rec.id, rec.topic);
      chanSchema.set(rec.id, rec.schemaId);
    } else if (rec.type === "Message") {
      const topic = topics.get(rec.channelId)!;
      const schema = schemaNames.get(chanSchema.get(rec.channelId)!)!;
      schemaByChannel.set(rec.channelId, schema);
      messages.push({
        topic,
        schema,
        logTime: rec.logTime,
        json: JSON.parse(dec.decode(rec.data)),
      });
    }
  }
  return { topics, schemaByChannel, messages };
}

function b64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

describe("buildNoiseMcap audio blocking", () => {
  it("streams a clip as many contiguous mono pcm-s16 blocks the Audio panel can play", async () => {
    const blob = await buildNoiseMcap([event({})], async () => new Blob(["x"]));
    const { messages } = await readMcap(blob);

    const audio = messages.filter((m) => m.topic === "/audio");
    // 30000 samples / (48000 * 0.2) = 3.125 → 4 blocks, not one giant message.
    expect(audio.length).toBe(4);
    expect(audio.every((m) => m.schema === "foxglove.RawAudio")).toBe(true);

    // Every block: mono, pcm-s16, correct sample rate, non-empty data.
    for (const m of audio) {
      const a = m.json as Record<string, unknown>;
      expect(a.format).toBe("pcm-s16");
      expect(a.number_of_channels).toBe(1);
      expect(a.sample_rate).toBe(SAMPLE_RATE);
      expect((a.data as string).length).toBeGreaterThan(0);
    }

    // Blocks are ordered and their start times advance ~200 ms; each block's
    // logTime lands exactly where the previous block's audio ended (contiguous
    // bitstream = seamless playback).
    for (let i = 1; i < audio.length; i++) {
      const prev = audio[i - 1];
      const prevSamples = b64ToInt16((prev.json as { data: string }).data).length;
      const expectedGapNs = BigInt(Math.round((prevSamples / SAMPLE_RATE) * 1e9));
      expect(audio[i].logTime - prev.logTime).toBe(expectedGapNs);
    }

    // Reassembled blocks reproduce the original 30000-sample mono track exactly.
    const rejoined = audio.flatMap((m) => [
      ...b64ToInt16((m.json as { data: string }).data),
    ]);
    expect(rejoined.length).toBe(CLIP_SAMPLES);
    expect(rejoined[0]).toBe(-10000);
    expect(rejoined[200]).toBe(-10000);
  });
});
