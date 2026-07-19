/**
 * Decode a recorded audio blob (webm/opus, mp4/aac, …) to 16-bit PCM, fully
 * in-browser. Used to produce universally-playable WAV downloads and RawAudio for
 * the MCAP export.
 */

/** Interleave an AudioBuffer's channels to little-endian int16 PCM bytes. */
function interleaveInt16(buffer: AudioBuffer): Uint8Array<ArrayBuffer> {
  const numCh = buffer.numberOfChannels;
  const n = buffer.length;
  const bytes = new Uint8Array(new ArrayBuffer(n * numCh * 2));
  const pcm = new Int16Array(bytes.buffer); // little-endian on all target platforms
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      pcm[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return bytes;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const pcm = interleaveInt16(buffer);
  const blockAlign = numCh * 2;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  let o = 0;
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
  };
  const u32 = (v: number) => {
    view.setUint32(o, v, true);
    o += 4;
  };
  const u16 = (v: number) => {
    view.setUint16(o, v, true);
    o += 2;
  };

  str("RIFF");
  u32(36 + pcm.byteLength);
  str("WAVE");
  str("fmt ");
  u32(16);
  u16(1); // PCM
  u16(numCh);
  u32(sampleRate);
  u32(sampleRate * blockAlign);
  u16(blockAlign);
  u16(16);
  str("data");
  u32(pcm.byteLength);

  return new Blob([header, pcm], { type: "audio/wav" });
}

let decodeCtx: AudioContext | null = null;

async function decode(blob: Blob): Promise<AudioBuffer> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  decodeCtx ??= new Ctor();
  return decodeCtx.decodeAudioData(await blob.arrayBuffer());
}

export async function blobToWav(blob: Blob): Promise<Blob> {
  return audioBufferToWav(await decode(blob));
}

export interface MonoPcm16 {
  /** Mono 16-bit PCM samples (host byte order; write little-endian on export). */
  samples: Int16Array;
  sampleRate: number;
}

/** Down-mix an AudioBuffer's channels to a single mono int16 track. */
function downmixMonoInt16(buffer: AudioBuffer): Int16Array {
  const numCh = buffer.numberOfChannels;
  const n = buffer.length;
  const out = new Int16Array(n);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < numCh; c++) s += channels[c][i];
    s = Math.max(-1, Math.min(1, s / numCh));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Decode a clip to a single mono 16-bit PCM track for MCAP `foxglove.RawAudio`.
 * Foxglove's Audio panel plays mono; the caller slices this into small
 * timestamped "blocks" so the panel sees a continuous bitstream it can play.
 */
export async function blobToMonoPcm16(blob: Blob): Promise<MonoPcm16> {
  const buffer = await decode(blob);
  return { samples: downmixMonoInt16(buffer), sampleRate: buffer.sampleRate };
}
