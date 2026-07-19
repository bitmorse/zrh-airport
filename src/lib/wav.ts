/**
 * Convert a recorded audio blob (webm/opus, mp4/aac, …) to a 16-bit PCM WAV blob,
 * fully in-browser. WAV plays everywhere, unlike the native MediaRecorder formats.
 */

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numCh * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
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
  u32(36 + dataSize);
  str("WAVE");
  str("fmt ");
  u32(16); // PCM chunk size
  u16(1); // PCM format
  u16(numCh);
  u32(sampleRate);
  u32(sampleRate * blockAlign);
  u16(blockAlign);
  u16(16); // bits per sample
  str("data");
  u32(dataSize);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

let decodeCtx: AudioContext | null = null;

export async function blobToWav(blob: Blob): Promise<Blob> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  decodeCtx ??= new Ctor();
  const audioBuffer = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
  return audioBufferToWav(audioBuffer);
}
