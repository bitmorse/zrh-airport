import { useCallback, useMemo, useRef, useState } from "react";
import { AirportSvg } from "./components/AirportSvg";
import { AtcPanel } from "./components/AtcPanel";
import { FlightDetails } from "./components/FlightDetails";
import { Legend } from "./components/Legend";
import { MovementsByHour } from "./components/MovementsByHour";
import { TrafficBar } from "./components/TrafficBar";
import { RecorderModal } from "./components/RecorderModal";
import { StatsModal } from "./components/StatsModal";
import { PoiManager } from "./components/PoiManager";
import { SettingsModal } from "./components/SettingsModal";
import { snapshotAircraft, type AircraftSnapshot } from "./data/adsb";
import { AIRPORTS, airportConfigByIcao } from "./data/airports";
import { addNoiseEvent, type NoiseEvent } from "./data/noiseStore";
import { totalPoints } from "./data/watchStore";
import { buildAirport } from "./domain/airport";
import { AirportContext } from "./hooks/useAirport";
import { useWatchedFlights } from "./hooks/useWatchedFlights";
import { useWatchTracker } from "./hooks/useWatchTracker";
import {
  useAutoNoiseTrigger,
  type NoiseMeta,
} from "./hooks/useAutoNoiseTrigger";
import { useDeviceHeading, requestHeadingPermission } from "./hooks/useDeviceHeading";
import { useGeoWatch, type GeoFix } from "./hooks/useGeoWatch";
import { useLiveTraffic } from "./hooks/useLiveTraffic";
import { useNoiseRecorder, type Recording } from "./hooks/useNoiseRecorder";
import { useNow } from "./hooks/useNow";
import { useSettings } from "./hooks/useSettings";
import { DEFAULT_ZOOM } from "./lib/viewport";

export default function App() {
  const [settings, updateSettings] = useSettings();
  const airport = useMemo(
    () => buildAirport(airportConfigByIcao(settings.airport)),
    [settings.airport],
  );
  const traffic = useLiveTraffic(settings, airport);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [airportMenu, setAirportMenu] = useState(false);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const now = useNow(1000);

  // Gamification: score + award a point when the selected flight completes.
  const { watched } = useWatchedFlights();
  const score = totalPoints(watched);
  useWatchTracker({
    newMovements: traffic.newMovements,
    selectedHex,
    aircraft: traffic.aircraft,
    trailFor: traffic.trailFor,
  });

  const handleSelect = useCallback((hex: string) => {
    setSelectedHex((cur) => (cur === hex ? null : hex));
  }, []);

  const selectedAircraft = useMemo(
    () => traffic.aircraft.find((a) => a.ac.hex === selectedHex) ?? null,
    [traffic.aircraft, selectedHex],
  );

  // Aircraft-noise recording + "where am I" location.
  const recorder = useNoiseRecorder();
  const [showLocation, setShowLocation] = useState(false);
  const [locateNonce, setLocateNonce] = useState(0);
  // Live GPS while the mic is on (for the geofence) or while showing my location.
  const geo = useGeoWatch(recorder.isArmed || showLocation);
  const heading = useDeviceHeading(showLocation);
  const arrivals = traffic.arrivals;

  const onLocate = useCallback(() => {
    void requestHeadingPermission();
    setShowLocation(true);
    setLocateNonce((n) => n + 1); // recenter on the user, even if already shown
  }, []);

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
        runwayEnd: meta?.end || null,
        kind: meta?.kind ?? null,
        geofenceRadiusM: meta?.geofenceRadiusM ?? null,
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

  const { activeCallsign } = useAutoNoiseTrigger({
    armed: recorder.isArmed,
    aircraft: traffic.aircraft,
    arrivals,
    departures: traffic.departures,
    now,
    lastUpdated: traffic.lastUpdated,
    recorder,
    userPos: geo.position,
    geofenceRadiusM: settings.geofenceRadiusM,
    fieldElevationFt: airport.config.fieldElevationFt,
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

  const switchAirport = useCallback(
    (icao: string) => {
      setAirportMenu(false);
      setSelectedHex(null);
      // New geometry ⇒ reset the framed view to the airport's default.
      updateSettings({ airport: icao, zoom: DEFAULT_ZOOM, cx: 0.5, cy: 0.5 });
    },
    [updateSettings],
  );

  return (
    <AirportContext.Provider value={airport}>
    <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3">
        <div className="relative">
          <button
            onClick={() => setAirportMenu((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-slate-100 hover:bg-slate-800"
            aria-haspopup="listbox"
            aria-expanded={airportMenu}
            title={`${airport.config.name} (${airport.config.icao}) · live runway traffic from open ADS-B · tap to switch airport`}
          >
            <span className="font-brand text-2xl font-black leading-none tracking-[0.18em]">
              {airport.config.iata}
            </span>
            <span className="text-sm text-slate-500" aria-hidden>
              ▾
            </span>
          </button>
          {airportMenu && (
            <>
              <button
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Close airport menu"
                onClick={() => setAirportMenu(false)}
              />
              <ul
                className="absolute left-0 top-full z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl"
                role="listbox"
              >
                {AIRPORTS.map((a) => (
                  <li key={a.icao}>
                    <button
                      onClick={() => switchAirport(a.icao)}
                      role="option"
                      aria-selected={a.icao === airport.config.icao}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800 ${
                        a.icao === airport.config.icao ? "bg-slate-800/60" : ""
                      }`}
                    >
                      <span className="font-brand text-base font-black tracking-wider text-slate-100">
                        {a.iata}
                      </span>
                      <span className="text-xs text-slate-400">{a.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 hidden text-[11px] text-slate-500 sm:block">
            {traffic.provider ?? "—"} · {activeCount}/{traffic.aircraft.length} on runways
          </span>
          <button
            onClick={() => setShowStats(true)}
            aria-label="Flights watched"
            title={`Flights watched · ${score} points`}
            className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-slate-200 hover:bg-slate-800"
          >
            <span aria-hidden>✈</span>
            <span className="text-xs font-semibold tabular-nums">{score}</span>
          </button>
          <button
            onClick={() => updateSettings({ muted: !settings.muted })}
            aria-label={settings.muted ? "Unmute cockpit audio" : "Mute cockpit audio"}
            aria-pressed={!settings.muted}
            title={settings.muted ? "Cockpit audio muted — tap to unmute" : "Mute cockpit audio"}
            className={`rounded-lg border p-1.5 hover:bg-slate-800 ${
              settings.muted
                ? "border-slate-700 text-slate-400"
                : "border-sky-500 bg-sky-600/20 text-sky-200"
            }`}
          >
            {settings.muted ? "🔇" : "🔊"}
          </button>
          <button
            onClick={() => setShowRecorder(true)}
            aria-label="Microphone"
            title="Microphone · noise recording"
            className={`rounded-lg border p-1.5 hover:bg-slate-800 ${
              recorder.isRecording
                ? "border-red-500 bg-red-600/20 text-red-200"
                : "border-slate-700 text-slate-200"
            }`}
          >
            🎤
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
        </div>
      </header>

      {/* Quick glance: next landing + departures. Above the map on mobile; on
          desktop it moves to the top of the sidebar (see below). */}
      <div className="px-4 pt-4 lg:hidden">
        <TrafficBar
          arrivals={arrivals}
          departures={traffic.departures}
          aircraft={traffic.aircraft}
          now={now}
          lastUpdated={traffic.lastUpdated}
          stale={stale}
          selectedHex={selectedHex}
          onSelect={handleSelect}
        />
      </div>

      <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-center">
        <section className="relative aspect-[28/25] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 lg:h-[calc(100dvh-6rem)] lg:w-auto lg:min-w-0 lg:flex-none">
          <AirportSvg
            aircraft={traffic.aircraft}
            counts={traffic.counts}
            lastUpdated={traffic.lastUpdated}
            selectedHex={selectedHex}
            trail={selectedHex ? traffic.trailFor(selectedHex) : undefined}
            userPosition={showLocation || recorder.isRecording ? geo.position : null}
            heading={heading}
            fenceRadiusM={settings.geofenceRadiusM}
            recording={recorder.isRecording}
            locateNonce={locateNonce}
            onLocate={onLocate}
            onSelect={handleSelect}
          />
        </section>

        <aside className="flex w-full flex-col gap-4 lg:w-72">
          {/* Desktop-only: the glance strip lives at the top of the sidebar (on
              mobile it sits above the map instead). */}
          <div className="hidden lg:block">
            <TrafficBar
              arrivals={arrivals}
              departures={traffic.departures}
              aircraft={traffic.aircraft}
              now={now}
              lastUpdated={traffic.lastUpdated}
              stale={stale}
              selectedHex={selectedHex}
              onSelect={handleSelect}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <FlightDetails
              item={selectedAircraft}
              lastUpdated={traffic.lastUpdated}
              onClear={() => setSelectedHex(null)}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <MovementsByHour
              log={traffic.movementLog}
              timeZone={airport.config.timeZone}
              now={now}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <AtcPanel
              arrivals={arrivals}
              departures={traffic.departures}
              now={now}
              onSelect={handleSelect}
            />
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
            Runway use, arrivals and departures are inferred from each aircraft’s
            position, track and altitude — not an official airport feed. Traffic from{" "}
            <span className="text-slate-400">adsb.lol / adsb.fi / airplanes.live</span>,
            routes from adsbdb. Everything runs in your browser and your settings, pins
            and recordings stay on your device.
          </p>
        </aside>
      </main>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          ageSec={ageSec}
          isFetching={traffic.isFetching}
          onRefresh={traffic.refetch}
        />
      )}
      {showStats && <StatsModal onClose={() => setShowStats(false)} />}
      {showRecorder && (
        <RecorderModal
          recorder={recorder}
          activeCallsign={activeCallsign}
          position={geo.position}
          onManualStop={onManualStop}
          onClose={() => setShowRecorder(false)}
        />
      )}
    </div>
    </AirportContext.Provider>
  );
}
