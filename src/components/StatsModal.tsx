import { useState } from "react";
import { totalPoints, type WatchedFlight } from "../data/watchStore";
import { useWatchedFlights } from "../hooks/useWatchedFlights";
import { AltitudeSparkline } from "./AltitudeSparkline";
import { Modal } from "./Modal";
import { NoiseTable } from "./NoiseTable";
import { TrajectoryMap } from "./TrajectoryMap";
import { BackIcon, CloseIcon, LandingIcon, MyLocationIcon, TakeoffIcon } from "./icons";

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Tab = "watched" | "measurements";

/**
 * The gamification hub: total score + how it's earned, the list of watched flights
 * (each with an altitude sparkline → a trajectory-map sheet), and the measurements
 * table moved in from the front page.
 */
export function StatsModal({ onClose }: { onClose: () => void }) {
  const { watched, remove } = useWatchedFlights();
  const [tab, setTab] = useState<Tab>("watched");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const sheet = sheetId ? watched.find((w) => w.id === sheetId) ?? null : null;

  return (
    <Modal title="Flights watched" onClose={onClose} maxWidth="max-w-lg">
      {sheet ? (
        <FlightSheet flight={sheet} onBack={() => setSheetId(null)} />
      ) : (
        <>
          <div className="mb-4 flex w-fit overflow-hidden border border-border text-xs">
            {(["watched", "measurements"] as Tab[]).map((t) => (
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
                {t}
              </button>
            ))}
          </div>
          {tab === "watched" ? (
            <WatchedTab watched={watched} onOpen={setSheetId} onRemove={remove} />
          ) : (
            <NoiseTable />
          )}
        </>
      )}
    </Modal>
  );
}

function WatchedTab({
  watched,
  onOpen,
  onRemove,
}: {
  watched: WatchedFlight[];
  onOpen: (id: string) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const points = totalPoints(watched);
  const landings = watched.filter((w) => w.kind === "landing").length;
  const takeoffs = watched.filter((w) => w.kind === "takeoff").length;
  const doubles = watched.filter((w) => w.points === 2).length;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-status-arrival">{points}</span>
        <span className="text-on-surface-variant">points</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        Watch a flight to completion to score: select a plane and keep it selected until it
        fully lands or takes off. You earn double when you also captured a GPS-tagged
        recording of it.
      </p>

      {watched.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-on-surface-variant">
          <span>{watched.length} flights</span>
          <span className="inline-flex items-center gap-1"><LandingIcon size={13} /> {landings} landings</span>
          <span className="inline-flex items-center gap-1"><TakeoffIcon size={13} /> {takeoffs} takeoffs</span>
          <span className="inline-flex items-center gap-1"><MyLocationIcon size={13} /> {doubles} with GPS audio</span>
        </div>
      )}

      {watched.length === 0 ? (
        <p className="text-xs text-muted">
          No flights watched yet. Tap a plane, keep it selected, and wait for it to land or
          take off.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {watched.map((w) => (
            <li
              key={w.id}
              className="flex items-center gap-2 bg-surface-container px-2.5 py-1.5"
            >
              <button
                type="button"
                onClick={() => onOpen(w.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
              >
                <span aria-hidden className="text-on-surface-variant">
                  {w.kind === "landing" ? <LandingIcon size={14} /> : <TakeoffIcon size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">
                    <span className="font-semibold text-on-surface">
                      {w.callsign ?? w.hex.toUpperCase()}
                    </span>
                    {w.type && <span className="text-muted"> · {w.type}</span>}
                    {w.end && <span className="text-status-arrival"> · {w.end}</span>}
                  </span>
                  <span className="flex items-center text-[10px] text-muted">
                    {hhmm(w.completedAt)}
                    {w.points === 2 && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-status-departure">
                        · 2× <MyLocationIcon size={11} />
                      </span>
                    )}
                  </span>
                </span>
                <span className="w-24 shrink-0">
                  <AltitudeSparkline trajectory={w.trajectory} />
                </span>
              </button>
              <button
                type="button"
                onClick={() => void onRemove(w.id)}
                aria-label="Delete watched flight"
                className="shrink-0 px-1.5 text-muted hover:bg-surface-container-high hover:text-status-alert"
              >
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlightSheet({ flight, onBack }: { flight: WatchedFlight; onBack: () => void }) {
  const alts = flight.trajectory.map((p) => p.alt).filter((a): a is number => a != null);
  const peak = alts.length ? Math.max(...alts) : null;
  const pts = flight.trajectory;
  const durS = pts.length >= 2 ? Math.round((pts[pts.length - 1].t - pts[0].t) / 1000) : 0;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1 text-xs uppercase text-status-arrival hover:underline"
      >
        <BackIcon size={13} /> Back
      </button>
      <div>
        <div className="flex items-center gap-1 font-semibold text-on-surface">
          {flight.kind === "landing" ? <LandingIcon size={15} /> : <TakeoffIcon size={15} />}{" "}
          {flight.callsign ?? flight.hex.toUpperCase()}
          {flight.type && <span className="text-muted"> · {flight.type}</span>}
          {flight.points === 2 && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-status-departure">
              2× <MyLocationIcon size={12} />
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted">
          {hhmm(flight.completedAt)}
          {flight.end && ` · RWY ${flight.end}`}
          {peak != null && ` · peak ${Math.round(peak).toLocaleString()} ft`}
          {durS > 0 && ` · ${Math.floor(durS / 60)}m ${durS % 60}s tracked`}
        </div>
      </div>
      <TrajectoryMap trajectory={flight.trajectory} />
      <AltitudeSparkline trajectory={flight.trajectory} />
    </div>
  );
}
