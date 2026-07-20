import { useEffect, useState } from "react";
import { PROVIDER_NAMES } from "../data/adsb";
import { DEFAULT_SETTINGS, useSettings } from "../hooks/useSettings";
import type { Units } from "../lib/format";

const NM_TO_KM = 1.852;
const M_PER_NM = 1852;
// Radius is stored in NM; show it in the user's units.
const radiusToDisplay = (nm: number, u: Units) =>
  u === "metric" ? Math.round(nm * NM_TO_KM) : Math.round(nm);
const displayToNm = (val: number, u: Units) => (u === "metric" ? val / NM_TO_KM : val);

// Geofence radius is stored in metres; show it as km (metric) or NM (imperial).
const geoToDisplay = (m: number, u: Units) =>
  u === "metric" ? +(m / 1000).toFixed(1) : +(m / M_PER_NM).toFixed(1);
const geoToMeters = (val: number, u: Units) =>
  u === "metric" ? val * 1000 : val * M_PER_NM;

/**
 * Settings dialog. All values are persisted to localStorage. The default data
 * source needs no credentials; the API-token field exists so a key can be
 * requested and stored locally if a provider ever requires one — no backend.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, update] = useSettings();
  const [pollSeconds, setPollSeconds] = useState(String(settings.pollSeconds));
  const [units, setUnits] = useState<Units>(settings.units);
  const [radius, setRadius] = useState(String(radiusToDisplay(settings.radiusNm, settings.units)));
  const [geofence, setGeofence] = useState(
    String(geoToDisplay(settings.geofenceRadiusM, settings.units)),
  );
  const [provider, setProvider] = useState(settings.provider ?? "");
  const [apiToken, setApiToken] = useState(settings.apiToken ?? "");

  // Switching units re-expresses the distance fields so they stay the same distance.
  function changeUnits(next: Units) {
    const nm = displayToNm(Number(radius) || settings.radiusNm, units);
    setRadius(String(radiusToDisplay(nm, next)));
    const m = geoToMeters(Number(geofence) || 0, units) || settings.geofenceRadiusM;
    setGeofence(String(geoToDisplay(m, next)));
    setUnits(next);
  }

  const metric = units === "metric";
  const radiusUnit = metric ? "km" : "nautical miles";
  const radiusMin = metric ? 9 : 5;
  const radiusMax = metric ? 463 : 250;
  const geoUnit = metric ? "km" : "NM";
  const geoMin = metric ? 0.3 : 0.2;
  const geoMax = metric ? 20 : 11;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const nm = displayToNm(Number(radius) || radiusToDisplay(DEFAULT_SETTINGS.radiusNm, units), units);
    const geoM = geoToMeters(Number(geofence) || geoToDisplay(DEFAULT_SETTINGS.geofenceRadiusM, units), units);
    update({
      pollSeconds: clamp(Number(pollSeconds) || DEFAULT_SETTINGS.pollSeconds, 10, 600),
      radiusNm: Math.round(clamp(nm, 5, 250)),
      geofenceRadiusM: Math.round(clamp(geoM, 300, 20000)),
      units,
      provider: provider || null,
      apiToken: apiToken.trim() || null,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Settings</h2>

        <div className="flex flex-col gap-4 text-sm">
          <Field label="Refresh interval (seconds)" hint="10–600">
            <input
              type="number"
              min={10}
              max={600}
              value={pollSeconds}
              onChange={(e) => setPollSeconds(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Units" hint="applies to distances, speeds and altitudes">
            <select
              value={units}
              onChange={(e) => changeUnits(e.target.value as Units)}
              className={inputCls}
            >
              <option value="metric">Metric (km, km/h, m)</option>
              <option value="imperial">Aviation (NM, kt, ft)</option>
            </select>
          </Field>

          <Field label={`Query radius (${radiusUnit})`} hint={`${radiusMin}–${radiusMax}`}>
            <input
              type="number"
              min={radiusMin}
              max={radiusMax}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field
            label={`Recording geofence radius (${geoUnit})`}
            hint={`${geoMin}–${geoMax} · aircraft entering this radius around your GPS location auto-record`}
          >
            <input
              type="number"
              step={0.1}
              min={geoMin}
              max={geoMax}
              value={geofence}
              onChange={(e) => setGeofence(e.target.value)}
              className={inputCls}
            />
          </Field>

          <Field label="Preferred data provider" hint="tried first; others are fallbacks">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className={inputCls}
            >
              <option value="">Auto (adsb.lol → fallbacks)</option>
              {PROVIDER_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="API token (reserved)"
            hint="not used by the current sources; stored only in your browser for future providers"
          >
            <input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="none required"
              className={inputCls}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-100 outline-none focus:border-sky-500";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}
