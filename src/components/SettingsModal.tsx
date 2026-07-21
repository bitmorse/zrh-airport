import { useState } from "react";
import { PROVIDER_NAMES } from "../data/adsb";
import type { DepartureEvent } from "../domain/departures";
import type { Arrival } from "../domain/predictions";
import { DEFAULT_SETTINGS, useSettings } from "../hooks/useSettings";
import type { Units } from "../lib/format";
import { AtcPanel } from "./AtcPanel";
import { Modal } from "./Modal";
import { PoiManager } from "./PoiManager";
import { RefreshIcon } from "./icons";

type Tab = "general" | "regions" | "atc";

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
 * source needs no credentials; the API-token field exists so a key can be requested
 * and stored locally if a provider ever requires one — no backend. Also hosts the
 * data-age readout + manual refresh (moved out of the header now that dead reckoning
 * makes it redundant there), plus the Regions-of-interest and ATC-listen panels as
 * their own tabs (they persist immediately via their own stores, no Save needed).
 */
export function SettingsModal({
  onClose,
  ageSec,
  isFetching,
  onRefresh,
  arrivals,
  departures,
  now,
  onSelect,
}: {
  onClose: () => void;
  ageSec: number | null;
  isFetching: boolean;
  onRefresh: () => void;
  arrivals: Arrival[];
  departures: DepartureEvent[];
  now: number;
  onSelect?: (hex: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, update] = useSettings();
  const [pollSeconds, setPollSeconds] = useState(String(settings.pollSeconds));
  const [units, setUnits] = useState<Units>(settings.units);
  const [radius, setRadius] = useState(String(radiusToDisplay(settings.radiusNm, settings.units)));
  const [geofence, setGeofence] = useState(
    String(geoToDisplay(settings.geofenceRadiusM, settings.units)),
  );
  const [cockpitSim, setCockpitSim] = useState(settings.cockpitSim);
  const [showWind, setShowWind] = useState(settings.showWind);
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

  function save() {
    const nm = displayToNm(Number(radius) || radiusToDisplay(DEFAULT_SETTINGS.radiusNm, units), units);
    const geoM = geoToMeters(Number(geofence) || geoToDisplay(DEFAULT_SETTINGS.geofenceRadiusM, units), units);
    update({
      pollSeconds: clamp(Number(pollSeconds) || DEFAULT_SETTINGS.pollSeconds, 10, 600),
      radiusNm: Math.round(clamp(nm, 5, 250)),
      geofenceRadiusM: Math.round(clamp(geoM, 300, 20000)),
      cockpitSim,
      showWind,
      units,
      provider: provider || null,
      apiToken: apiToken.trim() || null,
    });
    onClose();
  }

  return (
    <Modal title="Settings" onClose={onClose} maxWidth="max-w-lg">
      <div className="mb-4 flex w-fit overflow-hidden border border-border text-xs">
        {(
          [
            ["general", "Settings"],
            ["regions", "Regions"],
            ["atc", "ATC"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`px-3 py-1 uppercase ${
              tab === t
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "regions" ? (
        <PoiManager />
      ) : tab === "atc" ? (
        <AtcPanel
          arrivals={arrivals}
          departures={departures}
          now={now}
          onSelect={onSelect}
        />
      ) : (
        <>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-2 border border-border bg-surface-container px-3 py-2">
          <span className="text-[11px] text-on-surface-variant">
            Data {ageSec == null ? "—" : `updated ${ageSec}s ago`}
            {isFetching ? " · refreshing" : ""}
          </span>
          <button
            onClick={onRefresh}
            disabled={isFetching}
            className="flex shrink-0 items-center gap-1 border border-border px-2 py-0.5 text-xs uppercase text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40"
          >
            <RefreshIcon size={13} /> Refresh
          </button>
        </div>

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

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={cockpitSim}
            onChange={(e) => setCockpitSim(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span className="flex flex-col">
            <span className="font-medium text-on-surface">Cockpit simulation</span>
            <span className="text-[11px] text-muted">
              Hear what the pilot would hear — from ADS-B we estimate and play the cockpit
              alerts (GPWS altitude callouts) for the flight you have selected. Mute/unmute
              from the header.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={showWind}
            onChange={(e) => setShowWind(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span className="flex flex-col">
            <span className="font-medium text-on-surface">Wind overlay</span>
            <span className="text-[11px] text-muted">
              Show the current airport wind and a small arrow on each active aircraft
              for the crosswind pushing it sideways (dashed when it's gusty). Off by
              default; only fetches weather while switched on.
            </span>
          </span>
        </label>

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
          className="px-3 py-1.5 text-sm uppercase text-on-surface-variant hover:bg-surface-container"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="border border-primary bg-primary px-3 py-1.5 text-sm font-medium uppercase text-on-primary hover:bg-primary-container"
        >
          Save
        </button>
      </div>
        </>
      )}
    </Modal>
  );
}

const inputCls =
  "w-full border border-border bg-surface-container-lowest px-3 py-1.5 text-on-surface outline-none focus:border-2 focus:border-primary";

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
      <span className="font-medium text-on-surface">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
