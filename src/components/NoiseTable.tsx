import { useEffect, useRef, useState } from "react";
import { relLoudness, type NoiseEvent } from "../data/noiseStore";
import { useNoiseEvents } from "../hooks/useNoiseEvents";
import { useSettings } from "../hooks/useSettings";
import {
  formatAltitude,
  formatSpeed,
  formatVerticalRate,
  type Units,
} from "../lib/format";
import { downloadBlob } from "../lib/download";
import { buildNoiseMcap } from "../lib/mcap";
import { blobToWav } from "../lib/wav";
import {
  CloseIcon,
  DownloadIcon,
  LandingIcon,
  MyLocationIcon,
  PlayIcon,
  StopIcon,
  TakeoffIcon,
} from "./icons";

/** The kind marker for a measurement row. */
function KindIcon({ kind }: { kind: NoiseEvent["kind"] }) {
  if (kind === "departure") return <TakeoffIcon size={13} />;
  if (kind === "arrival") return <LandingIcon size={13} />;
  if (kind === "geofence") return <MyLocationIcon size={13} />;
  return null;
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}


function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(events: NoiseEvent[]) {
  const header = [
    "time",
    "kind",
    "callsign",
    "hex",
    "aircraft_type",
    "type_desc",
    "registration",
    "runway",
    "gs_kt",
    "alt_ft",
    "track_deg",
    "vrate_fpm",
    "ac_lat",
    "ac_lon",
    "obs_lat",
    "obs_lon",
    "geofence_radius_m",
    "held_s",
    "peak_rel",
    "peak_dbfs",
    "avg_dbfs",
    "duration_s",
  ];
  const rows = events.map((e) => [
    new Date(e.startedAt).toISOString(),
    e.kind ?? "",
    e.callsign ?? "",
    e.hex ?? "",
    e.aircraftType ?? "",
    e.aircraftTypeDesc ?? "",
    e.registration ?? "",
    e.runwayEnd ?? "",
    e.gsKt ?? "",
    e.altFt ?? "",
    e.track ?? "",
    e.verticalRateFpm ?? "",
    e.acLat ?? "",
    e.acLon ?? "",
    e.lat ?? "",
    e.lon ?? "",
    e.geofenceRadiusM ?? "",
    e.heldSeconds ?? "",
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
function kinematicsLine(e: NoiseEvent, units: Units): string | null {
  const parts: string[] = [];
  if (e.gsKt != null) parts.push(formatSpeed(e.gsKt, units));
  if (e.altFt != null) parts.push(formatAltitude(e.altFt, units));
  if (e.verticalRateFpm != null && Math.abs(e.verticalRateFpm) > 50) {
    parts.push(formatVerticalRate(e.verticalRateFpm, units));
  }
  return parts.length ? parts.join(" · ") : null;
}

export function NoiseTable() {
  const { events, remove, getAudio, relabel } = useNoiseEvents();
  const [{ units }] = useSettings();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<string | null>(null); // visible playback/export status
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  async function exportMcap() {
    setExporting(true);
    try {
      const blob = await buildNoiseMcap(events, getAudio);
      downloadBlob(blob, `zrh-noise-${Date.now()}.mcap`);
    } finally {
      setExporting(false);
    }
  }

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
    if (!blob) {
      setNote("This clip has no saved audio.");
      return;
    }
    setNote(null);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
      audioRef.current.onerror = () => {
        setNote("Couldn't play this clip — the browser can't decode this recording format.");
        setPlayingId(null);
      };
    }
    audioRef.current.src = url;
    try {
      await audioRef.current.play();
      setPlayingId(id);
    } catch (err) {
      setNote(`Couldn't play this clip: ${(err as Error)?.message ?? "playback was blocked"}.`);
      setPlayingId(null);
    }
  }

  if (events.length === 0) {
    return (
      <div className="text-sm">
        <h2 className="font-semibold uppercase tracking-wide text-on-surface">Measurements</h2>
        <p className="mt-1 text-[11px] text-muted">
          No recordings yet. Enable the microphone above; clips are captured
          automatically when an aircraft enters your geofence (or around a nearby
          landing/takeoff) and listed here.
        </p>
      </div>
    );
  }

  async function download(e: NoiseEvent) {
    const blob = await getAudio(e.id);
    if (!blob) {
      setNote("This clip has no saved audio to download.");
      return;
    }
    setNote(null);
    let out = blob;
    let ext = audioExt(blob.type);
    try {
      out = await blobToWav(blob); // universally playable
      ext = "wav";
    } catch (err) {
      // Surface it instead of silently shipping an undecodable file; still give them
      // the original recording, labelled with its real format.
      setNote(
        `Couldn't convert to WAV (${(err as Error)?.message ?? "decode failed"}) — downloaded the original ${ext.toUpperCase()} instead.`,
      );
    }
    const name = (e.callsign ?? e.hex ?? "clip").replace(/\s+/g, "");
    downloadBlob(out, `zrh-${name}-${hhmm(e.startedAt).replace(":", "")}.${ext}`);
  }

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold uppercase tracking-wide text-on-surface">
          Measurements <span className="text-xs text-muted">({events.length})</span>
        </h2>
        <div className="flex gap-1">
          <button
            onClick={() => exportCsv(events)}
            className="flex items-center gap-1 border border-border px-2 py-0.5 text-xs uppercase text-on-surface-variant hover:bg-surface-container"
          >
            <DownloadIcon size={13} /> CSV
          </button>
          <button
            onClick={exportMcap}
            disabled={exporting}
            className="flex items-center gap-1 border border-border px-2 py-0.5 text-xs uppercase text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            title="Foxglove MCAP: audio + GPS + measurement on one timeline"
          >
            {exporting ? "building…" : <><DownloadIcon size={13} /> MCAP</>}
          </button>
        </div>
      </div>
      {note && (
        <p role="status" className="mb-2 text-[11px] leading-relaxed text-status-alert">
          {note}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="uppercase tracking-wide text-muted">
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
          <tbody className="text-on-surface-variant">
            {events.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="py-1.5 pr-2 tabular-nums">{hhmm(e.startedAt)}</td>
                <td className="py-1.5 pr-2 font-mono">
                  <div className="flex items-center gap-1">
                    <KindIcon kind={e.kind} />
                    {e.callsign ?? e.hex?.toUpperCase() ?? "—"}
                    {e.runwayEnd && (
                      <span className="ml-1 text-status-arrival">{e.runwayEnd}</span>
                    )}
                  </div>
                  {(e.aircraftType || e.registration) && (
                    <div className="text-[10px] text-muted">
                      {[e.aircraftType, e.registration].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {kinematicsLine(e, units) && (
                    <div className="text-[10px] text-muted">
                      {kinematicsLine(e, units)}
                    </div>
                  )}
                  {e.candidates && e.candidates.length > 1 && (
                    <select
                      value={e.primaryHex ?? e.hex ?? ""}
                      onChange={(ev) => void relabel(e.id, ev.target.value)}
                      aria-label="Relabel aircraft"
                      className="mt-1 max-w-full border border-border bg-surface-container-lowest px-1 py-0.5 text-[10px] text-on-surface-variant outline-none focus:border-primary"
                    >
                      {e.candidates.map((c) => (
                        <option key={c.hex} value={c.hex}>
                          {(c.callsign ?? c.hex.toUpperCase()) +
                            " · " +
                            (c.closestApproachM >= 1000
                              ? `${(c.closestApproachM / 1000).toFixed(1)} km`
                              : `${Math.round(c.closestApproachM)} m`)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="py-1.5 pr-2 tabular-nums text-on-surface-variant">
                  {e.lat != null && e.lon != null
                    ? `${e.lat.toFixed(3)}, ${e.lon.toFixed(3)}`
                    : "—"}
                </td>
                <td className="py-1.5 pr-2 tabular-nums">
                  <span className="font-semibold text-on-surface">
                    {relLoudness(e.peakDbfs)}
                  </span>
                  <span className="text-muted"> dB*</span>
                </td>
                <td className="py-1.5">
                  <div className="flex gap-1">
                    {e.hasAudio && (
                      <>
                        <button
                          onClick={() => void play(e.id)}
                          aria-label={playingId === e.id ? "Stop playback" : "Play recording"}
                          className="px-1.5 text-on-surface-variant hover:bg-surface-container"
                        >
                          {playingId === e.id ? <StopIcon size={14} /> : <PlayIcon size={14} />}
                        </button>
                        <button
                          onClick={() => void download(e)}
                          aria-label="Download recording"
                          className="px-1.5 text-on-surface-variant hover:bg-surface-container"
                        >
                          <DownloadIcon size={14} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => void remove(e.id)}
                      aria-label="Delete measurement"
                      className="px-1.5 text-muted hover:bg-surface-container hover:text-status-alert"
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted">
        * uncalibrated relative loudness (0–100 from dBFS), not certified SPL. While
        the mic is recording, in-app playback may be quiet or routed to the earpiece
        (a phone-OS limit) — use the download button to save a clip as WAV and play it
        at full volume.
      </p>
    </div>
  );
}
