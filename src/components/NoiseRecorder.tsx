import type { GeoFix } from "../hooks/useGeoWatch";
import type { NoiseRecorder as Recorder } from "../hooks/useNoiseRecorder";

/** dBFS (≤0) → 0..100% meter width (−60 dBFS floor). */
function meterPct(dbfs: number): number {
  return Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
}

/**
 * Microphone control + live level meter. When enabled, the app auto-records the
 * noise around each predicted landing; a manual record button is also provided.
 */
export function NoiseRecorder({
  recorder,
  activeCallsign,
  position,
  onManualStop,
}: {
  recorder: Recorder;
  activeCallsign: string | null;
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

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <h2 className="font-semibold text-slate-200">Landing noise</h2>
        <p className="text-[11px] text-slate-500">
          records around each landing · relative loudness (uncalibrated)
        </p>
      </div>

      {!isArmed ? (
        <button
          onClick={() => void arm()}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          🎤 Enable microphone
        </button>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isRecording ? "animate-pulse bg-red-500" : "bg-emerald-500"
              }`}
            />
            <span className="text-xs text-slate-300">
              {isRecording
                ? `Recording ${activeCallsign ?? "…"}`
                : "Listening — auto-records around landings"}
            </span>
          </div>

          {/* Live level meter. */}
          <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
            <div
              className="h-full rounded bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500 transition-[width] duration-75 ease-out"
              style={{ width: `${meterPct(level).toFixed(0)}%` }}
            />
          </div>

          <div className="text-[11px] text-slate-500">
            {position
              ? `📍 ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}${
                  position.accuracyM != null
                    ? ` (±${Math.round(position.accuracyM)} m)`
                    : ""
                }`
              : "📍 acquiring GPS…"}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void manualToggle()}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
                isRecording
                  ? "bg-red-600 text-white hover:bg-red-500"
                  : "border border-slate-700 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {isRecording ? "■ Stop" : "● Record now"}
            </button>
            <button
              onClick={disarm}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Disable
            </button>
          </div>
        </>
      )}

      {error && <div className="text-[11px] text-red-400">{error}</div>}
    </div>
  );
}
