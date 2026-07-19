import { useCallback, useEffect, useRef, useState } from "react";

export interface Recording {
  blob: Blob | null;
  peakDbfs: number;
  avgDbfs: number;
  durationMs: number;
}

export interface NoiseRecorder {
  isArmed: boolean;
  isRecording: boolean;
  /** Live input level in dBFS (≤ 0). */
  level: number;
  error: string | null;
  arm: () => Promise<void>;
  disarm: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<Recording>;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

function rmsToDbfs(buf: Float32Array<ArrayBuffer>): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/**
 * Microphone loudness meter + recorder, entirely in-browser. `arm()` requests the
 * mic and starts live dBFS metering; `startRecording()`/`stopRecording()` capture
 * a clip and report its peak/average loudness measured over the recorded window.
 */
export function useNoiseRecorder(): NoiseRecorder {
  const [isArmed, setIsArmed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(-100);
  const [error, setError] = useState<string | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const buf = useRef<Float32Array<ArrayBuffer> | null>(null);
  const raf = useRef<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recording = useRef(false);
  const peak = useRef(-100);
  const sum = useRef(0);
  const count = useRef(0);
  const startTs = useRef(0);

  const tick = useCallback(() => {
    const an = analyser.current;
    const b = buf.current;
    if (an && b) {
      an.getFloatTimeDomainData(b);
      const dbfs = rmsToDbfs(b);
      setLevel(dbfs);
      if (recording.current) {
        if (dbfs > peak.current) peak.current = dbfs;
        sum.current += dbfs;
        count.current += 1;
      }
    }
    raf.current = requestAnimationFrame(tick);
  }, []);

  const arm = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone isn’t available in this browser.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new Ctor();
      ctx.current = audioCtx;
      const src = audioCtx.createMediaStreamSource(s);
      const an = audioCtx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      analyser.current = an;
      buf.current = new Float32Array(new ArrayBuffer(an.fftSize * 4));
      setIsArmed(true);
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Couldn’t access the microphone.",
      );
    }
  }, [tick]);

  const disarm = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (recorder.current && recorder.current.state === "recording") {
      recorder.current.stop();
    }
    recording.current = false;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close();
    ctx.current = null;
    analyser.current = null;
    setIsArmed(false);
    setIsRecording(false);
    setLevel(-100);
  }, []);

  const startRecording = useCallback(() => {
    const s = stream.current;
    if (!s || recording.current || typeof MediaRecorder === "undefined") return;
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    recorder.current = rec;
    peak.current = -100;
    sum.current = 0;
    count.current = 0;
    startTs.current = Date.now();
    recording.current = true;
    rec.start();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback((): Promise<Recording> => {
    return new Promise((resolve) => {
      const rec = recorder.current;
      const result = (blob: Blob | null): Recording => ({
        blob,
        peakDbfs: peak.current,
        avgDbfs: count.current ? sum.current / count.current : -100,
        durationMs: Date.now() - startTs.current,
      });
      if (!rec || !recording.current) {
        resolve(result(null));
        return;
      }
      rec.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: rec.mimeType || "audio/webm",
        });
        recording.current = false;
        setIsRecording(false);
        resolve(result(blob));
      };
      rec.stop();
    });
  }, []);

  useEffect(() => () => disarm(), [disarm]);

  return { isArmed, isRecording, level, error, arm, disarm, startRecording, stopRecording };
}
