import { useCallback, useMemo, useRef, useState } from "react";
import { AirportSvg } from "./components/AirportSvg";
import { ArrivalsBoard } from "./components/ArrivalsBoard";
import { FlightDetails } from "./components/FlightDetails";
import { Legend } from "./components/Legend";
import { TrafficBar } from "./components/TrafficBar";
import { NoiseRecorder } from "./components/NoiseRecorder";
import { NoiseTable } from "./components/NoiseTable";
import { PoiManager } from "./components/PoiManager";
import { SettingsModal } from "./components/SettingsModal";
import { snapshotAircraft, type AircraftSnapshot } from "./data/adsb";
import { addNoiseEvent, type NoiseEvent } from "./data/noiseStore";
import {
  useLandingNoiseTrigger,
  type NoiseMeta,
} from "./hooks/useLandingNoiseTrigger";
import { useGeoWatch, type GeoFix } from "./hooks/useGeoWatch";
import { useLiveTraffic } from "./hooks/useLiveTraffic";
import { useNoiseRecorder, type Recording } from "./hooks/useNoiseRecorder";
import { useNow } from "./hooks/useNow";
import { useSettings } from "./hooks/useSettings";

export default function App() {
  const [settings] = useSettings();
  const traffic = useLiveTraffic(settings);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const now = useNow(1000);

  const handleSelect = useCallback((hex: string) => {
    setSelectedHex((cur) => (cur === hex ? null : hex));
  }, []);

  const selectedAircraft = useMemo(
    () => traffic.aircraft.find((a) => a.ac.hex === selectedHex) ?? null,
    [traffic.aircraft, selectedHex],
  );

  // Landing-noise recording.
  const recorder = useNoiseRecorder();
  const geo = useGeoWatch(recorder.isArmed); // live GPS while the mic is on
  const arrivals = traffic.arrivals;

  // Latest aircraft list, read at save time to enrich a measurement by hex.
  const aircraftRef = useRef(traffic.aircraft);
  aircraftRef.current = traffic.aircraft;

  const saveNoise = useCallback(
    (meta: NoiseMeta | null, rec: Recording, loc: GeoFix | null) => {
      if (!rec.blob) return;
      // Prefer the snapshot taken when recording began (aircraft at the runway);
      // fall back to a fresh lookup for manual recordings.
      const fallback = meta?.hex
        ? aircraftRef.current.find((a) => a.ac.hex === meta.hex)?.ac
        : undefined;
      const snap: AircraftSnapshot | null =
        meta?.snapshot ?? (fallback ? snapshotAircraft(fallback) : null);
      const ev: NoiseEvent = {
        id: crypto.randomUUID(),
        hex: meta?.hex ?? null,
        callsign: meta?.callsign ?? null,
        runwayEnd: meta?.end ?? null,
        kind: meta?.kind ?? null,
        aircraftType: snap?.type ?? null,
        aircraftTypeDesc: snap?.typeDesc ?? null,
        registration: snap?.registration ?? null,
        gsKt: snap?.gsKt ?? null,
        altFt: snap?.altFt ?? null,
        track: snap?.track ?? null,
        verticalRateFpm: snap?.verticalRateFpm ?? null,
        acLat: snap?.acLat ?? null,
        acLon: snap?.acLon ?? null,
        heldSeconds: meta?.heldMs != null ? Math.round(meta.heldMs / 1000) : null,
        lat: loc?.lat ?? null,
        lon: loc?.lon ?? null,
        peakDbfs: rec.peakDbfs,
        avgDbfs: rec.avgDbfs,
        startedAt: Date.now() - rec.durationMs,
        durationMs: rec.durationMs,
        hasAudio: true,
      };
      void addNoiseEvent(ev, rec.blob);
    },
    [],
  );

  const { activeCallsign } = useLandingNoiseTrigger({
    armed: recorder.isArmed,
    aircraft: traffic.aircraft,
    arrivals,
    departures: traffic.departures,
    now,
    lastUpdated: traffic.lastUpdated,
    recorder,
    onComplete: (meta, rec) => saveNoise(meta, rec, geo.ref.current),
  });

  const onManualStop = useCallback(
    (rec: Recording) => {
      // Tag a manual recording with the soonest current arrival, if any.
      const soonest = arrivals[0];
      const meta: NoiseMeta | null = soonest
        ? { hex: soonest.hex, callsign: soonest.callsign, end: soonest.end, kind: "arrival" }
        : null;
      saveNoise(meta, rec, geo.ref.current);
    },
    [arrivals, saveNoise, geo.ref],
  );

  const ageSec =
    traffic.lastUpdated != null
      ? Math.max(0, Math.round((now - traffic.lastUpdated) / 1000))
      : null;
  const stale = ageSec != null && ageSec > Math.max(90, settings.pollSeconds * 2);

  const activeCount = useMemo(
    () => traffic.aircraft.filter((a) => a.assignment).length,
    [traffic.aircraft],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5">
        <span
          className="font-brand text-2xl font-black leading-none tracking-[0.18em] text-slate-100"
          title="Zürich Airport (LSZH) · live runway traffic from open ADS-B"
        >
          ZRH
        </span>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end leading-tight">
            <span className={`text-xs ${stale ? "text-amber-400" : "text-slate-300"}`}>
              {ageSec == null ? "—" : `${ageSec}s ago`}
              {traffic.isFetching ? " · refreshing" : ""}
            </span>
            <span className="hidden text-[11px] text-slate-500 sm:block">
              {traffic.provider ?? "—"} · {activeCount}/{traffic.aircraft.length} on runways
            </span>
          </div>
          <button
            onClick={traffic.refetch}
            disabled={traffic.isFetching}
            aria-label="Refresh now"
            title="Refresh now"
            className={`rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40 ${
              traffic.isFetching ? "animate-spin" : ""
            }`}
          >
            ⟳
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg border border-slate-700 p-1.5 text-slate-200 hover:bg-slate-800"
            aria-label="Open settings"
            title="Settings"
          >
            ⚙︎
          </button>
        </div>
      </header>

      {/* Mobile-only quick glance above the map: next landing + departures. */}
      <div className="px-4 pt-4 lg:hidden">
        <TrafficBar
          arrivals={arrivals}
          departures={traffic.departures}
          now={now}
          lastUpdated={traffic.lastUpdated}
          stale={stale}
          onSelect={handleSelect}
        />
      </div>

      <main className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="relative aspect-[28/25] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 lg:aspect-auto lg:min-h-[60vh] lg:flex-1">
          <AirportSvg
            aircraft={traffic.aircraft}
            counts={traffic.counts}
            lastUpdated={traffic.lastUpdated}
            selectedHex={selectedHex}
            onSelect={handleSelect}
          />
        </section>

        <aside className="flex w-full flex-col gap-4 lg:w-72">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <FlightDetails
              item={selectedAircraft}
              onClear={() => setSelectedHex(null)}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <ArrivalsBoard
              aircraft={traffic.aircraft}
              departures={traffic.departures}
              lastUpdated={traffic.lastUpdated}
              now={now}
              stale={stale}
              selectedHex={selectedHex}
              onSelect={handleSelect}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <NoiseRecorder
              recorder={recorder}
              activeCallsign={activeCallsign}
              position={geo.position}
              onManualStop={onManualStop}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <NoiseTable />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <PoiManager />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <Legend />
          </div>

          {traffic.isError && !traffic.lastUpdated && (
            <div className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
              Couldn’t reach any ADS-B provider. Retrying…
              <div className="mt-1 text-xs text-red-300/70">
                {traffic.error?.message}
              </div>
            </div>
          )}

          <p className="px-1 text-[11px] leading-relaxed text-slate-500">
            Runway use is inferred from aircraft position, track and altitude —
            not an official airport feed. Data:{" "}
            <span className="text-slate-400">adsb.lol / adsb.fi / airplanes.live</span>.
            Everything runs in your browser; nothing is sent to a server.
          </p>
        </aside>
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
