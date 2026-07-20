import { useState } from "react";
import { totalPoints, type WatchedFlight } from "../data/watchStore";
import { useWatchedFlights } from "../hooks/useWatchedFlights";
import { AltitudeSparkline } from "./AltitudeSparkline";
import { Modal } from "./Modal";
import { NoiseTable } from "./NoiseTable";
import { TrajectoryMap } from "./TrajectoryMap";

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
          <div className="mb-4 flex w-fit overflow-hidden rounded-md border border-slate-700 text-xs">
            {(["watched", "measurements"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`px-3 py-1 capitalize ${
                  tab === t ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"
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
        <span className="text-3xl font-bold tabular-nums text-sky-300">{points}</span>
        <span className="text-slate-400">points</span>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Watch a flight to completion to score: select a plane and keep it selected until it
        fully lands or takes off. You earn double when you also captured a GPS-tagged
        recording of it.
      </p>

      {watched.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span>{watched.length} flights</span>
          <span>🛬 {landings} landings</span>
          <span>🛫 {takeoffs} takeoffs</span>
          <span>📍 {doubles} with GPS audio</span>
        </div>
      )}

      {watched.length === 0 ? (
        <p className="text-xs text-slate-600">
          No flights watched yet. Tap a plane, keep it selected, and wait for it to land or
          take off.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {watched.map((w) => (
            <li
              key={w.id}
              className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-2.5 py-1.5"
            >
              <button
                type="button"
                onClick={() => onOpen(w.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
              >
                <span aria-hidden>{w.kind === "landing" ? "🛬" : "🛫"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">
                    <span className="font-semibold text-slate-100">
                      {w.callsign ?? w.hex.toUpperCase()}
                    </span>
                    {w.type && <span className="text-slate-500"> · {w.type}</span>}
                    {w.end && <span className="text-sky-300"> · {w.end}</span>}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {hhmm(w.completedAt)}
                    {w.points === 2 && <span className="text-amber-300"> · 2× 📍</span>}
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
                className="shrink-0 rounded px-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-300"
              >
                ✕
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
      <button type="button" onClick={onBack} className="w-fit text-xs text-sky-300 hover:underline">
        ← Back
      </button>
      <div>
        <div className="font-semibold text-slate-100">
          {flight.kind === "landing" ? "🛬" : "🛫"} {flight.callsign ?? flight.hex.toUpperCase()}
          {flight.type && <span className="text-slate-500"> · {flight.type}</span>}
          {flight.points === 2 && <span className="ml-1 text-amber-300">2× 📍</span>}
        </div>
        <div className="text-[11px] text-slate-500">
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
