import { afterEach, describe, expect, it, vi } from "vitest";
import { blobToWav } from "./wav";

type Win = Record<string, unknown>;
const win = () => window as unknown as Win;

/** jsdom's Blob lacks arrayBuffer(); build a minimal Blob-like the decoder can read. */
const clip = (bytes: number[], type: string) =>
  ({ type, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as Blob;

/** jsdom's Blob also lacks arrayBuffer() on the read side; use FileReader. */
const readBytes = (blob: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });

/** A tiny fake AudioBuffer the encoder can read. */
const fakeBuffer = {
  numberOfChannels: 1,
  length: 4,
  sampleRate: 44100,
  getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]),
} as unknown as AudioBuffer;

class FakeOfflineAudioContext {
  decodeAudioData = vi.fn(async () => fakeBuffer);
}

afterEach(() => {
  delete win().OfflineAudioContext;
  delete win().AudioContext;
});

describe("blobToWav", () => {
  it("decodes via OfflineAudioContext (never a realtime AudioContext) and emits audio/wav", async () => {
    const realtimeCtor = vi.fn();
    win().OfflineAudioContext = FakeOfflineAudioContext;
    win().AudioContext = realtimeCtor;

    const out = await blobToWav(clip([1, 2, 3], "audio/webm"));

    expect(out).toBeInstanceOf(Blob);
    expect(out.type).toBe("audio/wav");
    // A realtime AudioContext must NOT be created (that's what hits the iOS cap).
    expect(realtimeCtor).not.toHaveBeenCalled();

    // Valid RIFF/WAVE header.
    const bytes = await readBytes(out);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
  });

  it("falls back to a realtime context (closed after) when OfflineAudioContext is absent", async () => {
    const close = vi.fn();
    const decodeAudioData = vi.fn(async () => fakeBuffer);
    const realtimeCtor = vi.fn(() => ({ decodeAudioData, close }));
    win().AudioContext = realtimeCtor;

    const out = await blobToWav(clip([1], "audio/mp4"));

    expect(out.type).toBe("audio/wav");
    expect(realtimeCtor).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled(); // released, not leaked
  });
});
