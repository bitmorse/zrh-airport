import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AirportSvg } from "./components/AirportSvg";
import { FlightDetails } from "./components/FlightDetails";
import { Legend } from "./components/Legend";
import { MovementsByHour, WEEKDAYS } from "./components/MovementsByHour";
import { TrafficBar } from "./components/TrafficBar";
import { RecorderModal } from "./components/RecorderModal";
import { StatsModal } from "./components/StatsModal";
import { SettingsModal } from "./components/SettingsModal";
import { snapshotAircraft, type AircraftSnapshot } from "./data/adsb";
import { recentCountsByEnd } from "./data/airportStats";
import { AIRPORTS, airportConfigByIcao } from "./data/airports";
import {
  addNoiseEvent,
  type NoiseCandidate,
  type NoiseEvent,
  type NoiseObserverPoint,
} from "./data/noiseStore";
import { totalPoints } from "./data/watchStore";
import { buildAirport } from "./domain/airport";
import {
  attributeCandidates,
  CAPTURE_RADIUS_M,
  type AttributionAircraft,
} from "./domain/attribution";
import {
  AUTO_IDLE_MS,
  pickInteresting,
  RELEASE_AGL_FT,
  shouldRelease,
} from "./domain/autoSelect";
import { flightStatusLabel } from "./domain/flightStatus";
import { heightAglFt } from "./domain/gpws";
import {
  byRunway,
  hasActivity,
  localWeekday,
  recentActivityByEnd,
  summarize,
} from "./domain/movementStats";
import * as gpwsAudio from "./lib/gpwsAudio";
import { useAirportRecent } from "./hooks/useAirportRecent";
import { useAirportStats } from "./hooks/useAirportStats";
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
import {
  ChevronDownIcon,
  MicOnIcon,
  PlaneIcon,
  SettingsIcon,
  SoundOffIcon,
  SoundOnIcon,
} from "./components/icons";

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
  const [micHint, setMicHint] = useState(false);
  const [airportMenu, setAirportMenu] = useState(false);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const now = useNow(1000);

  // Track whether the current selection is the user's or an auto-pick, and when the
  // user last acted — so auto-select only steps in after a minute of no user choice.
  const selectedHexRef = useRef<string | null>(null);
  selectedHexRef.current = selectedHex;
  const selSourceRef = useRef<"user" | "auto" | null>(null);
  const lastUserAtRef = useRef(Date.now());

  const handleSelect = useCallback((hex: string) => {
    const next = selectedHexRef.current === hex ? null : hex;
    lastUserAtRef.current = Date.now();
    selSourceRef.current = next ? "user" : null;
    setSelectedHex(next);
  }, []);

  const clearSelection = useCallback(() => {
    lastUserAtRef.current = Date.now();
    selSourceRef.current = null;
    setSelectedHex(null);
  }, []);

  // Manually panning/zooming the map counts as activity, so idle auto-select won't
  // hijack a hand-set view (and won't churn while the user is examining a held target).
  const markUserActivity = useCallback(() => {
    lastUserAtRef.current = Date.now();
  }, []);

  // Gamification scores only flights the *user* actively watched, not auto-picks.
  const userSelectedHex = selSourceRef.current === "user" ? selectedHex : null;
  const { watched } = useWatchedFlights();
  const score = totalPoints(watched);
  useWatchTracker({
    newMovements: traffic.newMovements,
    selectedHex: userSelectedHex,
    aircraft: traffic.aircraft,
    trailFor: traffic.trailFor,
  });

  const selectedAircraft = useMemo(
    () => traffic.aircraft.find((a) => a.ac.hex === selectedHex) ?? null,
    [traffic.aircraft, selectedHex],
  );

  // A meaningful phase phrase for the selected aircraft (e.g. "just landed"), from its
  // live arrival/departure record + ground state — shared by the detail panel and board.
  const selectedStatus = useMemo(() => {
    if (!selectedAircraft) return null;
    return flightStatusLabel({
      ac: selectedAircraft.ac,
      assignment: selectedAircraft.assignment,
      arrival: traffic.arrivals.find((a) => a.hex === selectedHex),
      departure: traffic.departures.find((d) => d.hex === selectedHex),
    });
  }, [selectedAircraft, traffic.arrivals, traffic.departures, selectedHex]);

  // Auto-select an interesting flight when the user has left the selection empty for
  // a while; hand off to the next once the tracked one lands & stops, leaves the feed,
  // or has climbed clear of the field. Release is altitude-based (not viewport-based),
  // so following the tracked plane doesn't cause it to be dropped and re-picked.
  const fieldElevationFt = airport.config.fieldElevationFt;
  const geoidFt = airport.config.geoidFt ?? 0;
  useEffect(() => {
    if (selSourceRef.current === "user" && selectedHexRef.current) return; // user wins
    if (Date.now() - lastUserAtRef.current < AUTO_IDLE_MS) return; // wait out the idle gap

    const curAuto = selSourceRef.current === "auto" ? selectedHexRef.current : null;
    if (curAuto) {
      const ac = traffic.aircraft.find((w) => w.ac.hex === curAuto)?.ac;
      const climbing = !!ac && !ac.onGround && (ac.verticalRateFpm ?? 0) > 100;
      const climbedOut =
        !!ac && climbing && heightAglFt(ac, fieldElevationFt, geoidFt) > RELEASE_AGL_FT;
      if (!shouldRelease(ac, climbedOut)) return; // keep tracking the current one
    }
    const next = pickInteresting(
      traffic.arrivals,
      traffic.departures,
      traffic.aircraft,
      fieldElevationFt,
      geoidFt,
    );
    if (next && next !== selectedHexRef.current) {
      selSourceRef.current = "auto";
      setSelectedHex(next);
    } else if (!next && curAuto) {
      selSourceRef.current = null;
      setSelectedHex(null);
    }
  }, [
    now,
    traffic.arrivals,
    traffic.departures,
    traffic.aircraft,
    airport,
    fieldElevationFt,
    geoidFt,
  ]);

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

  const flashMicHint = useCallback(() => {
    setMicHint(true);
    window.setTimeout(() => setMicHint(false), 3000);
  }, []);

  // Read at save time (without re-creating saveNoise): the live aircraft list, the
  // per-aircraft trail accessor, and the field elevation.
  const aircraftRef = useRef(traffic.aircraft);
  aircraftRef.current = traffic.aircraft;
  const trailForRef = useRef(traffic.trailFor);
  trailForRef.current = traffic.trailFor;
  const fieldElevRef = useRef(airport.config.fieldElevationFt);
  fieldElevRef.current = airport.config.fieldElevationFt;

  // The observer's GPS track over the current recording, so each candidate's distance
  // series is measured against where the user actually was moment-to-moment. Reset on
  // the rising edge of recording; appended as fixes arrive.
  const observerTrackRef = useRef<NoiseObserverPoint[]>([]);
  const wasRecordingRef = useRef(false);
  // The user's manual choice of primary label during a recording (applied at save).
  const [manualPrimary, setManualPrimary] = useState<string | null>(null);
  const manualPrimaryRef = useRef<string | null>(null);
  manualPrimaryRef.current = manualPrimary;
  useEffect(() => {
    if (recorder.isRecording && !wasRecordingRef.current) {
      observerTrackRef.current = []; // rising edge — fresh clip
      setManualPrimary(null);
    }
    wasRecordingRef.current = recorder.isRecording;
    if (recorder.isRecording && geo.position) {
      const p = geo.position;
      const track = observerTrackRef.current;
      const last = track[track.length - 1];
      if (!last || last.t !== p.ts) track.push({ t: p.ts, lat: p.lat, lon: p.lon });
    }
  }, [recorder.isRecording, geo.position]);

  const saveNoise = useCallback(
    (meta: NoiseMeta | null, rec: Recording, loc: GeoFix | null) => {
      if (!rec.blob) return;
      const end = Date.now();
      const start = end - rec.durationMs;

      // Every nearby aircraft's track over the clip window, ranked by closest approach
      // to the observer. Seed each trail with the current fix so very short clips
      // (10 s poll cadence) still yield at least one in-window sample.
      const trailFor = trailForRef.current;
      const acList: AttributionAircraft[] = aircraftRef.current.map((w) => {
        const ac = w.ac;
        const trail = [...trailFor(ac.hex)];
        const last = trail[trail.length - 1];
        if (!last || last.t < end) {
          trail.push({ lat: ac.lat, lon: ac.lon, alt: ac.altGeomFt ?? ac.altFt, t: end });
        }
        return {
          hex: ac.hex,
          callsign: ac.flight,
          aircraftType: ac.type,
          aircraftTypeDesc: ac.typeDesc,
          registration: ac.registration,
          gsKt: ac.gs,
          altFt: ac.altFt,
          trackDeg: ac.track,
          verticalRateFpm: ac.verticalRateFpm,
          trail,
        };
      });
      // Observer series over the clip; fall back to the single save-time fix.
      const observer: NoiseObserverPoint[] =
        observerTrackRef.current.length > 0
          ? observerTrackRef.current.slice()
          : loc
            ? [{ t: start, lat: loc.lat, lon: loc.lon }]
            : [];
      const { candidates, primaryHex } = attributeCandidates({
        window: { start, end },
        observer,
        fieldElevationFt: fieldElevRef.current,
        aircraft: acList,
      });

      // Primary precedence: the user's live pick → nearest candidate → trigger hex.
      const manual = manualPrimaryRef.current;
      const pickedHex =
        (manual && candidates.some((c) => c.hex === manual) ? manual : null) ?? primaryHex;
      const primary = candidates.find((c) => c.hex === pickedHex) ?? null;

      // When nothing was in range (no GPS / no trail), fall back to the trigger's
      // snapshot so the clip still gets a best-effort label.
      const fallbackAc = meta?.hex
        ? aircraftRef.current.find((a) => a.ac.hex === meta.hex)?.ac
        : undefined;
      const snap: AircraftSnapshot | null =
        meta?.snapshot ?? (fallbackAc ? snapshotAircraft(fallbackAc) : null);

      const ev: NoiseEvent = {
        id: crypto.randomUUID(),
        hex: primary?.hex ?? meta?.hex ?? null,
        callsign: primary?.callsign ?? meta?.callsign ?? null,
        runwayEnd: meta?.end || null,
        kind: meta?.kind ?? null,
        geofenceRadiusM: meta?.geofenceRadiusM ?? null,
        aircraftType: primary?.aircraftType ?? snap?.type ?? null,
        aircraftTypeDesc: primary?.aircraftTypeDesc ?? snap?.typeDesc ?? null,
        registration: primary?.registration ?? snap?.registration ?? null,
        gsKt: primary?.closest.gsKt ?? snap?.gsKt ?? null,
        altFt: primary?.closest.altFt ?? snap?.altFt ?? null,
        track: primary?.closest.trackDeg ?? snap?.track ?? null,
        verticalRateFpm: primary?.closest.verticalRateFpm ?? snap?.verticalRateFpm ?? null,
        acLat: primary?.closest.acLat ?? snap?.acLat ?? null,
        acLon: primary?.closest.acLon ?? snap?.acLon ?? null,
        heldSeconds: meta?.heldMs != null ? Math.round(meta.heldMs / 1000) : null,
        lat: loc?.lat ?? null,
        lon: loc?.lon ?? null,
        peakDbfs: rec.peakDbfs,
        avgDbfs: rec.avgDbfs,
        startedAt: start,
        durationMs: rec.durationMs,
        hasAudio: true,
        candidates,
        observerTrack: observer,
        primaryHex: primary?.hex ?? null,
        captureRadiusM: CAPTURE_RADIUS_M,
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

  // Manual recordings no longer guess a callsign — proximity attribution in saveNoise
  // labels them from the nearest aircraft (or the user's live pick).
  const onManualStop = useCallback(
    (rec: Recording) => saveNoise(null, rec, geo.ref.current),
    [saveNoise, geo.ref],
  );

  const ageSec =
    traffic.lastUpdated != null
      ? Math.max(0, Math.round((now - traffic.lastUpdated) / 1000))
      : null;
  // Stale when the data is too old to trust, OR when every provider was behind this poll
  // (positions delayed even though the fetch timestamp keeps advancing).
  const stale =
    (ageSec != null && ageSec > Math.max(90, settings.pollSeconds * 2)) || traffic.stale;

  // Cockpit sim runs the GPWS state machine + on-screen callout readout; audio only
  // plays when not muted and not recording (the OS mutes/reroutes playback then), so
  // callouts don't get half-swallowed mid-approach.
  const cockpitActive = settings.cockpitSim;
  const cockpitAudio = settings.cockpitSim && !settings.muted && !recorder.isRecording;
  const effectiveMuted = settings.muted || recorder.isRecording;

  // Live "who's nearest to me right now" ranking for the recorder UI — the same
  // proximity logic used at save time, over each aircraft's current position. Updates
  // as polls/GPS refresh. Empty without a GPS fix.
  const liveCandidates = useMemo<NoiseCandidate[]>(() => {
    if (!geo.position) return [];
    const t = geo.position.ts;
    const observer = [{ t, lat: geo.position.lat, lon: geo.position.lon }];
    const acList: AttributionAircraft[] = traffic.aircraft.map((w) => {
      const ac = w.ac;
      return {
        hex: ac.hex,
        callsign: ac.flight,
        aircraftType: ac.type,
        aircraftTypeDesc: ac.typeDesc,
        registration: ac.registration,
        gsKt: ac.gs,
        altFt: ac.altFt,
        trackDeg: ac.track,
        verticalRateFpm: ac.verticalRateFpm,
        trail: [{ lat: ac.lat, lon: ac.lon, alt: ac.altGeomFt ?? ac.altFt, t }],
      };
    });
    return attributeCandidates({
      window: { start: t, end: t },
      observer,
      fieldElevationFt: airport.config.fieldElevationFt,
      aircraft: acList,
    }).candidates;
  }, [traffic.aircraft, geo.position, airport.config.fieldElevationFt]);

  // The primary shown live: the user's pick if still in range, else the nearest.
  const primaryCand =
    (manualPrimary && liveCandidates.find((c) => c.hex === manualPrimary)) ||
    liveCandidates[0] ||
    null;
  const primaryCallsign = primaryCand
    ? (primaryCand.callsign ?? primaryCand.hex.toUpperCase())
    : activeCallsign;
  const recorderCandidates = useMemo(
    () =>
      liveCandidates.map((c) => ({
        hex: c.hex,
        callsign: c.callsign,
        distanceM: c.closestApproachM,
      })),
    [liveCandidates],
  );

  const activeCount = useMemo(
    () => traffic.aircraft.filter((a) => a.assignment).length,
    [traffic.aircraft],
  );

  // Two windows of the backend collector's real history:
  //  • "today" (days=1) = the actual last 24 h — drives the live map heatmap and the
  //    card's default view; polled so "right now" stays current.
  //  • "usual" (days=60) = the ~2-month average by hour — the card's comparison tab;
  //    fetched lazily (only once the user opens it).
  const [statView, setStatView] = useState<"today" | "usual">("today");
  // Which local weekday the "usual" tab averages (default: today's weekday).
  const [usualDow, setUsualDow] = useState<number>(() => localWeekday(Date.now(), airport.config.timeZone));
  const todayStats = useAirportStats(airport.config.icao, 1, { refetchInterval: 3 * 60_000 });
  const usualStats = useAirportStats(airport.config.icao, 60, {
    enabled: statView === "usual",
    dow: usualDow,
  });
  // Rolling recent window drives the heatmap directly (smooth "now"); polled ~60 s.
  const recentStats = useAirportRecent(airport.config.icao);

  const localRunways = useMemo(() => byRunway(traffic.movementLog), [traffic.movementLog]);
  const localSummary = useMemo(() => summarize(traffic.movementLog), [traffic.movementLog]);

  const activeStats = statView === "usual" ? usualStats : todayStats;
  const statRunways = activeStats.data ? activeStats.data.runways : localRunways;
  const statSummary = activeStats.data ? activeStats.data.summary : localSummary;
  const statSourceNote = activeStats.data
    ? statView === "usual"
      ? `server · ${activeStats.data.windowDays}-day average · ${WEEKDAYS[usualDow]}`
      : "server · last 24 h"
    : activeStats.isError
      ? "device history · server unavailable"
      : localSummary.landings + localSummary.takeoffs > 0
        ? "device history"
        : undefined;

  // Map heatmap: real movements per runway end. Prefer the rolling recent endpoint;
  // fall back to the "today" (days=1) current-hour derivation until it's deployed, then
  // to this device's own live counts — so the map is always meaningful.
  const heatCounts = useMemo(() => {
    if (recentStats.data) {
      const c = recentCountsByEnd(recentStats.data);
      if (hasActivity(c)) return c;
    }
    const today = todayStats.data
      ? recentActivityByEnd(todayStats.data.runways, now, airport.config.timeZone)
      : {};
    return hasActivity(today) ? today : traffic.counts;
  }, [recentStats.data, todayStats.data, now, airport.config.timeZone, traffic.counts]);

  const switchAirport = useCallback(
    (icao: string) => {
      setAirportMenu(false);
      lastUserAtRef.current = Date.now();
      selSourceRef.current = null;
      setSelectedHex(null);
      // New geometry ⇒ reset the framed view to the airport's default.
      updateSettings({ airport: icao, zoom: DEFAULT_ZOOM, cx: 0.5, cy: 0.5 });
    },
    [updateSettings],
  );

  return (
    <AirportContext.Provider value={airport}>
    <div className="flex min-h-dvh flex-col bg-surface text-on-surface">
      <header className="border-b border-border px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3">
        <div className="relative">
          <button
            onClick={() => setAirportMenu((o) => !o)}
            className="flex items-center gap-1.5 px-1 py-0.5 text-on-surface hover:bg-surface-container"
            aria-haspopup="listbox"
            aria-expanded={airportMenu}
            title={`${airport.config.name} (${airport.config.icao}) · live runway traffic from open ADS-B · tap to switch airport`}
          >
            <span className="font-brand text-2xl font-black leading-none tracking-[0.18em]">
              {airport.config.iata}
            </span>
            <ChevronDownIcon className="text-muted" size={14} />
          </button>
          {airportMenu && (
            <>
              <button
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Close airport menu"
                onClick={() => setAirportMenu(false)}
              />
              <ul
                className="absolute left-0 top-full z-20 mt-1 min-w-44 overflow-hidden border border-border bg-surface-container-lowest py-1"
                role="listbox"
              >
                {AIRPORTS.map((a) => (
                  <li key={a.icao}>
                    <button
                      onClick={() => switchAirport(a.icao)}
                      role="option"
                      aria-selected={a.icao === airport.config.icao}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-container ${
                        a.icao === airport.config.icao ? "bg-surface-container" : ""
                      }`}
                    >
                      <span className="font-brand text-base font-black tracking-wider text-on-surface">
                        {a.iata}
                      </span>
                      <span className="text-xs text-on-surface-variant">{a.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 hidden text-[11px] uppercase tracking-wide text-muted sm:block">
            {traffic.provider ?? "—"} · {activeCount}/{traffic.aircraft.length} on runways
          </span>
          <button
            onClick={() => setShowStats(true)}
            aria-label="Flights watched"
            title={`Flights watched · ${score} points`}
            className="flex items-center gap-1 border border-border px-2 py-1.5 text-on-surface-variant hover:bg-surface-container"
          >
            <PlaneIcon size={16} />
            <span className="text-xs font-semibold tabular-nums">{score}</span>
          </button>
          <button
            onClick={() => {
              // A tap is a user gesture — unlock/resume the audio context here so the
              // first unmute (and any later tap) primes mobile Safari for playback.
              gpwsAudio.unlock();
              if (recorder.isRecording) flashMicHint();
              else updateSettings({ muted: !settings.muted });
            }}
            aria-label={effectiveMuted ? "Unmute cockpit audio" : "Mute cockpit audio"}
            aria-pressed={!effectiveMuted}
            aria-disabled={recorder.isRecording}
            title={
              recorder.isRecording
                ? "Cockpit audio is off while recording — stop recording to listen"
                : settings.muted
                  ? "Cockpit audio muted — tap to unmute"
                  : "Mute cockpit audio"
            }
            className={`border p-1.5 ${
              recorder.isRecording
                ? "cursor-not-allowed border-border text-muted opacity-50"
                : effectiveMuted
                  ? "border-border text-on-surface-variant hover:bg-surface-container"
                  : "border-primary bg-primary text-on-primary hover:bg-primary-container"
            }`}
          >
            {effectiveMuted ? <SoundOffIcon size={18} /> : <SoundOnIcon size={18} />}
          </button>
          <button
            onClick={() => setShowRecorder(true)}
            aria-label="Microphone"
            title={
              recorder.isRecording
                ? `Recording ${primaryCallsign ?? "…"} · tap to change`
                : "Microphone · noise recording"
            }
            className={`flex items-center gap-1 border p-1.5 hover:bg-surface-container ${
              recorder.isRecording
                ? "border-status-alert bg-status-alert text-on-primary"
                : "border-border text-on-surface-variant"
            }`}
          >
            <MicOnIcon size={18} />
            {recorder.isRecording && primaryCallsign && (
              <span className="max-w-24 truncate font-mono text-xs font-semibold">
                {primaryCallsign}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="border border-border p-1.5 text-on-surface-variant hover:bg-surface-container"
            aria-label="Open settings"
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
        </div>
      </header>

      {micHint && (
        <div className="fixed right-4 top-14 z-40 border border-border bg-surface-container-lowest px-3 py-1.5 text-xs text-on-surface-variant">
          Turn off recording first to hear cockpit audio.
        </div>
      )}

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
          selectedStatus={selectedStatus}
          onSelect={handleSelect}
        />
      </div>

      <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-center">
        <section className="relative aspect-[28/25] w-full overflow-hidden border border-border bg-surface-container-lowest lg:h-[calc(100dvh-6rem)] lg:w-auto lg:min-w-0 lg:flex-none">
          <AirportSvg
            aircraft={traffic.aircraft}
            counts={heatCounts}
            lastUpdated={traffic.lastUpdated}
            selectedHex={selectedHex}
            trail={selectedHex ? traffic.trailFor(selectedHex) : undefined}
            userPosition={showLocation || recorder.isRecording ? geo.position : null}
            heading={heading}
            fenceRadiusM={settings.geofenceRadiusM}
            recording={recorder.isRecording}
            locateNonce={locateNonce}
            onLocate={onLocate}
            onInteract={markUserActivity}
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
              selectedStatus={selectedStatus}
              onSelect={handleSelect}
            />
          </div>

          <div className="border border-border bg-surface-container-low p-4">
            <FlightDetails
              item={selectedAircraft}
              status={selectedStatus}
              lastUpdated={traffic.lastUpdated}
              cockpitActive={cockpitActive}
              cockpitAudio={cockpitAudio}
              onClear={clearSelection}
            />
          </div>

          <div className="border border-border bg-surface-container-low p-4">
            <MovementsByHour
              runways={statRunways}
              summary={statSummary}
              timeZone={airport.config.timeZone}
              now={now}
              view={statView}
              onViewChange={setStatView}
              dow={usualDow}
              onDowChange={setUsualDow}
              loading={activeStats.isLoading && !activeStats.data}
              sourceNote={statSourceNote}
            />
          </div>

          <div className="border border-border bg-surface-container-low p-4">
            <Legend />
          </div>

          {traffic.isError && !traffic.lastUpdated && (
            <div className="border border-status-alert bg-error-container p-4 text-sm text-on-error-container">
              Couldn’t reach any ADS-B provider. Retrying…
              <div className="mt-1 text-xs text-on-error-container">
                {traffic.error?.message}
              </div>
            </div>
          )}

          <p className="px-1 text-[11px] leading-relaxed text-muted">
            Runway use, arrivals and departures are inferred from each aircraft’s
            position, track and altitude — not an official airport feed. Traffic from{" "}
            <span className="text-on-surface-variant">adsb.lol / adsb.fi / airplanes.live</span>,
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
          arrivals={arrivals}
          departures={traffic.departures}
          now={now}
          onSelect={(hex) => {
            handleSelect(hex);
            setShowSettings(false);
          }}
        />
      )}
      {showStats && <StatsModal onClose={() => setShowStats(false)} />}
      {showRecorder && (
        <RecorderModal
          recorder={recorder}
          primaryCallsign={primaryCallsign}
          candidates={recorderCandidates}
          primaryHex={primaryCand?.hex ?? null}
          onPickPrimary={setManualPrimary}
          position={geo.position}
          onManualStop={onManualStop}
          onClose={() => setShowRecorder(false)}
        />
      )}
    </div>
    </AirportContext.Provider>
  );
}
