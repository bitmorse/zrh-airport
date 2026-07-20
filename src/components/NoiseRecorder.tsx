import type { GeoFix } from "../hooks/useGeoWatch";
import type { NoiseRecorder as Recorder } from "../hooks/useNoiseRecorder";
import { LandingIcon, MicOnIcon, MyLocationIcon, SquareIcon, StopIcon } from "./icons";

/** A nearby aircraft the clip could be attributed to, with live distance to the user. */
export interface RecorderCandidate {
  hex: string;
  callsign: string | null;
  distanceM: number;
}

/** dBFS (≤0) → 0..100% meter width (−60 dBFS floor). */
function meterPct(dbfs: number): number {
  return Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
}

/** Flat VU colour by level (no gradient): quiet green → loud red. */
function meterColor(pct: number): string {
  if (pct >= 90) return "var(--color-status-alert)";
  if (pct >= 66) return "var(--color-status-departure)";
  return "var(--color-status-cleared)";
}

/** "1.2 km" / "340 m" for a candidate distance. */
function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/**
 * Microphone control + live level meter. When enabled, the app auto-records the
 * noise around each predicted landing; a manual record button is also provided.
 * While recording it names the aircraft the clip is attributed to (the nearest, by
 * default) and lists nearby aircraft sorted by distance so you can pick the one
 * you're actually looking at.
 */
export function NoiseRecorder({
  recorder,
  primaryCallsign,
  candidates,
  primaryHex,
  onPickPrimary,
  position,
  onManualStop,
}: {
  recorder: Recorder;
  primaryCallsign: string | null;
  candidates: RecorderCandidate[];
  primaryHex: string | null;
  onPickPrimary: (hex: string) => void;
  position: GeoFix | null;
  onManualStop: (rec: Awaited<ReturnType<Recorder["stopRecording"]>>) => void;
}) {
  const { isArmed, isRecording, level, error, arm, disarm, startRecording, stopRecording } =
    recorder;

  async function manualToggle() {
    if (isRecording) {
      const rec = await stopRecording();
      onManualStop(rec);
    } else {
      startRecording();
    }
  }

  const pct = meterPct(level);

  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <div>
        <h2 className="font-semibold uppercase tracking-wide text-on-surface">Aircraft noise</h2>
        <p className="text-[11px] text-muted">
          auto-records aircraft entering your GPS geofence · landings/takeoffs as a
          fallback · relative loudness (uncalibrated)
        </p>
      </div>

      {!isArmed ? (
        <button
          onClick={() => void arm()}
          className="flex w-fit items-center gap-1.5 bg-primary px-2.5 py-1 text-xs font-medium uppercase text-on-primary hover:bg-primary-container"
        >
          <MicOnIcon size={14} /> Enable mic
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 ${
                isRecording ? "animate-pulse bg-status-alert" : "bg-status-cleared"
              }`}
            />
            <span className="text-xs text-on-surface-variant">
              {isRecording
                ? `Recording ${primaryCallsign ?? "…"}`
                : "Listening — records aircraft inside your geofence"}
            </span>
          </div>

          {/* Live level meter — flat fill, colour by level (no gradient). */}
          <div className="h-2 w-full overflow-hidden bg-surface-container-high">
            <div
              className="h-full transition-[width] duration-75 ease-out"
              style={{ width: `${pct.toFixed(0)}%`, background: meterColor(pct) }}
            />
          </div>

          {/* Nearby aircraft, nearest-first, with live distance — tap to re-attribute
              the clip to the one you're actually looking at. */}
          {candidates.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="text-[10px] uppercase tracking-wide text-muted">
                Nearby · tap to label
              </div>
              {candidates.slice(0, 6).map((c) => {
                const isPrimary = c.hex === primaryHex;
                return (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => onPickPrimary(c.hex)}
                    aria-label={`Label as ${c.callsign ?? c.hex.toUpperCase()}`}
                    aria-pressed={isPrimary}
                    className={`flex items-center gap-2 px-2 py-1 text-left text-xs ${
                      isPrimary
                        ? "bg-primary text-on-primary"
                        : "text-on-surface-variant hover:bg-surface-container"
                    }`}
                  >
                    <LandingIcon size={12} />
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {c.callsign ?? c.hex.toUpperCase()}
                    </span>
                    <span className="shrink-0 tabular-nums">{fmtDist(c.distanceM)}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-1 text-[11px] text-muted">
            <MyLocationIcon size={12} />
            {position
              ? `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}${
                  position.accuracyM != null
                    ? ` (±${Math.round(position.accuracyM)} m)`
                    : ""
                }`
              : "acquiring GPS…"}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void manualToggle()}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium uppercase ${
                isRecording
                  ? "bg-status-alert text-on-primary hover:bg-error"
                  : "border border-border text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              {isRecording ? (
                <>
                  <StopIcon size={12} /> Stop
                </>
              ) : (
                <>
                  <SquareIcon size={12} /> Rec
                </>
              )}
            </button>
            <button
              onClick={disarm}
              className="border border-border px-2.5 py-1 text-xs uppercase text-on-surface-variant hover:bg-surface-container"
            >
              Disable
            </button>
          </div>
        </>
      )}

      {error && <div className="text-[11px] text-status-alert">{error}</div>}
    </div>
  );
}
