import type { AtcRole } from "../data/atcFeeds";
import type { DepartureEvent } from "../domain/departures";
import {
  activeRunwayEnds,
  onFrequencyCandidates,
  type Candidate,
} from "../domain/onFrequency";
import type { Arrival } from "../domain/predictions";
import { useAirport } from "../hooks/useAirport";
import { useAtcFeeds } from "../hooks/useAtcFeeds";
import { useAtcPlayer } from "../hooks/useAtcPlayer";
import { formatDuration, formatEta } from "../lib/format";

const ROLE_LABEL: Record<AtcRole, string> = {
  approach: "Approach",
  tower: "Tower",
  departure: "Departure",
  ground: "Ground",
};

/** Short right-aligned status for a candidate, live where it makes sense. */
function candidateNote(c: Candidate, now: number): string {
  if (c.kind === "arrival") return `on final ${formatEta(c.etaSeconds ?? 0)}`;
  if (c.phase === "roll") {
    return c.waitedMs != null ? `cleared · held ${formatDuration(c.waitedMs / 1000)}` : "cleared";
  }
  if (c.phase === "holding") {
    return c.holdingSinceMs != null
      ? `holding ${formatDuration((now - c.holdingSinceMs) / 1000)}`
      : "holding";
  }
  return "climbing";
}

/**
 * "Listen" panel. ATC audio is per-position (role), not per-runway, and carries no
 * callsign — so we pair a bring-your-own stream with the app's ADS-B inference:
 * the active runways and the aircraft plausibly on that frequency, so you can tell
 * what/who is being talked about. Audio lags the map, hence the delay note.
 */
export function AtcPanel({
  arrivals,
  departures,
  now,
  onSelect,
}: {
  arrivals: Arrival[];
  departures: DepartureEvent[];
  now: number;
  onSelect?: (hex: string) => void;
}) {
  const { config } = useAirport();
  const { feeds, setUrl } = useAtcFeeds(config.icao);
  const player = useAtcPlayer();

  const activeEnds = activeRunwayEnds(arrivals, departures);
  const candidates = player.playingRole
    ? onFrequencyCandidates(player.playingRole, arrivals, departures)
    : [];

  return (
    <div className="text-sm">
      <div className="mb-2">
        <h2 className="font-semibold text-slate-200">Listen · ATC</h2>
        <p className="text-[11px] text-slate-500">
          bring-your-own stream · plays in your browser
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {feeds.map((f) => (
          <div key={f.role} className="flex items-center gap-2">
            <button
              onClick={() => player.toggle(f.role, f.url)}
              disabled={!f.url.trim()}
              aria-label={player.playingRole === f.role ? `Stop ${f.label}` : `Play ${f.label}`}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs ${
                player.playingRole === f.role
                  ? "bg-red-600 text-white hover:bg-red-500"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              } disabled:opacity-30`}
            >
              {player.playingRole === f.role ? "■" : "▶"}
            </button>
            <span className="w-16 shrink-0 text-xs text-slate-300">{f.label}</span>
            <input
              value={f.url}
              onChange={(e) => setUrl(f.role, e.target.value)}
              placeholder="add stream URL"
              inputMode="url"
              aria-label={`${f.label} stream URL`}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
            />
          </div>
        ))}
      </div>

      {player.error && <p className="mt-2 text-[11px] text-red-400">{player.error}</p>}

      {player.playingRole && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <div className="text-xs font-semibold text-slate-200">
            {ROLE_LABEL[player.playingRole]}{" "}
            <span className="font-normal text-slate-400">
              · active {activeEnds.length ? activeEnds.join(" · ") : "—"}
            </span>
          </div>

          <label className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
            <span className="shrink-0">audio ~{player.delaySec}s behind</span>
            <input
              type="range"
              min={0}
              max={90}
              value={player.delaySec}
              onChange={(e) => player.setDelaySec(Number(e.target.value))}
              aria-label="Estimated audio delay in seconds"
              className="flex-1"
            />
          </label>

          <div className="mt-2 text-[11px] font-medium text-slate-400">On frequency now</div>
          {candidates.length === 0 ? (
            <p className="mt-0.5 text-[11px] text-slate-500">No matching traffic right now.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {candidates.map((c) => (
                <li key={c.hex}>
                  <button
                    onClick={() => onSelect?.(c.hex)}
                    className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-slate-800"
                  >
                    <span aria-hidden>{c.kind === "arrival" ? "🛬" : "🛫"}</span>
                    <span className="font-mono text-slate-200">{c.callsign}</span>
                    <span className="text-sky-300">{c.end}</span>
                    <span className="ml-auto tabular-nums text-slate-500">
                      {candidateNote(c, now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
        A frequency covers a controller position, not one runway — the active runways
        and the “on frequency” list are inferred from ADS-B, and the audio lags the map,
        so the match is a best guess. No feeds are bundled; paste your own source (e.g.
        an Icecast MP3). LiveATC’s terms don’t permit embedding their streams here.
      </p>
    </div>
  );
}
