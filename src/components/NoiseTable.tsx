import { useEffect, useRef, useState } from "react";
import { relLoudness, type NoiseEvent } from "../data/noiseStore";
import { useNoiseEvents } from "../hooks/useNoiseEvents";
import { blobToWav } from "../lib/wav";

function hhmm(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(events: NoiseEvent[]) {
  const header = [
    "time",
    "callsign",
    "hex",
    "runway",
    "lat",
    "lon",
    "peak_rel",
    "peak_dbfs",
    "avg_dbfs",
    "duration_s",
  ];
  const rows = events.map((e) => [
    new Date(e.startedAt).toISOString(),
    e.callsign ?? "",
    e.hex ?? "",
    e.runwayEnd ?? "",
    e.lat ?? "",
    e.lon ?? "",
    relLoudness(e.peakDbfs),
    e.peakDbfs.toFixed(1),
    e.avgDbfs.toFixed(1),
    (e.durationMs / 1000).toFixed(1),
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(","))
    .join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `zrh-noise-${Date.now()}.csv`);
}

function audioExt(type: string): string {
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "audio";
}

/**
 * Offline table of recorded landing-noise measurements: aircraft, where it was
 * measured, peak loudness, and playback of the captured audio.
 */
export function NoiseTable() {
  const { events, remove, getAudio } = useNoiseEvents();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      audioRef.current?.pause();
    };
  }, []);

  async function play(id: string) {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    const blob = await getAudio(id);
    if (!blob) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
    }
    audioRef.current.src = url;
    void audioRef.current.play();
    setPlayingId(id);
  }

  if (events.length === 0) {
    return (
      <div className="text-sm">
        <h2 className="font-semibold text-slate-200">Measurements</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          No recordings yet. Enable the microphone above; clips are captured
          automatically around landings and listed here.
        </p>
      </div>
    );
  }

  async function download(e: NoiseEvent) {
    const blob = await getAudio(e.id);
    if (!blob) return;
    let out = blob;
    let ext = audioExt(blob.type);
    try {
      out = await blobToWav(blob); // universally playable
      ext = "wav";
    } catch {
      /* fall back to the native recording format */
    }
    const name = (e.callsign ?? e.hex ?? "clip").replace(/\s+/g, "");
    downloadBlob(out, `zrh-${name}-${hhmm(e.startedAt).replace(":", "")}.${ext}`);
  }

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-slate-200">
          Measurements <span className="text-xs text-slate-500">({events.length})</span>
        </h2>
        <button
          onClick={() => exportCsv(events)}
          className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          ⭳ Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-1 pr-2 font-medium">Time</th>
              <th className="pb-1 pr-2 font-medium">Aircraft</th>
              <th className="pb-1 pr-2 font-medium">Location</th>
              <th className="pb-1 pr-2 font-medium" title="uncalibrated relative loudness">
                Peak
              </th>
              <th className="pb-1 font-medium" />
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {events.map((e) => (
              <tr key={e.id} className="border-t border-slate-800">
                <td className="py-1.5 pr-2 tabular-nums">{hhmm(e.startedAt)}</td>
                <td className="py-1.5 pr-2 font-mono">
                  {e.callsign ?? e.hex?.toUpperCase() ?? "—"}
                  {e.runwayEnd && (
                    <span className="ml-1 text-sky-300">{e.runwayEnd}</span>
                  )}
                </td>
                <td className="py-1.5 pr-2 tabular-nums text-slate-400">
                  {e.lat != null && e.lon != null
                    ? `${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}`
                    : "—"}
                </td>
                <td className="py-1.5 pr-2 tabular-nums">
                  <span className="font-semibold text-slate-200">
                    {relLoudness(e.peakDbfs)}
                  </span>
                  <span className="text-slate-500"> dB*</span>
                </td>
                <td className="py-1.5">
                  <div className="flex gap-1">
                    {e.hasAudio && (
                      <>
                        <button
                          onClick={() => void play(e.id)}
                          aria-label={playingId === e.id ? "Stop playback" : "Play recording"}
                          className="rounded px-1.5 text-slate-300 hover:bg-slate-800"
                        >
                          {playingId === e.id ? "■" : "▶"}
                        </button>
                        <button
                          onClick={() => void download(e)}
                          aria-label="Download recording"
                          className="rounded px-1.5 text-slate-300 hover:bg-slate-800"
                        >
                          ⭳
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => void remove(e.id)}
                      aria-label="Delete measurement"
                      className="rounded px-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-slate-600">
        * uncalibrated relative loudness (0–100 from dBFS), not certified SPL. While
        the mic is recording, in-app playback may be quiet or routed to the earpiece
        (a phone-OS limit) — use ⭳ to download a clip as WAV and play it at full volume.
      </p>
    </div>
  );
}
