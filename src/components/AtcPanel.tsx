import { useCallback, useState } from "react";
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
import { formatDuration, formatEta } from "../lib/format";
import { LandingIcon, TakeoffIcon } from "./icons";
import { SdrChannel } from "./SdrChannel";

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
 * "Listen" panel. ATC audio comes from an airport-sdr receiver (bring your own, or the
 * shipped demo): each embedded channel plays in its own low-latency frame and reports
 * live carrier / level / listener state. Audio carries no callsign, so we pair the live
 * channel with the app's ADS-B inference — the active runways and the aircraft plausibly
 * on that position — so you can tell what/who is being talked about.
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
  const { server, setServer, channels, setChannel } = useAtcFeeds(config.icao);
  // The single channel currently playing (only one at a time), for the on-frequency match.
  const [activeRole, setActiveRole] = useState<AtcRole | null>(null);

  const onPlaying = useCallback((role: AtcRole, playing: boolean) => {
    setActiveRole((cur) => (playing ? role : cur === role ? null : cur));
  }, []);

  const activeEnds = activeRunwayEnds(arrivals, departures);
  const candidates = activeRole
    ? onFrequencyCandidates(activeRole, arrivals, departures)
    : [];

  return (
    <div className="text-sm">
      <div className="mb-2">
        <h2 className="font-semibold uppercase tracking-wide text-on-surface">Listen · ATC</h2>
        <p className="text-[11px] text-muted">airport-sdr receiver · plays in your browser</p>
      </div>

      <label className="mb-3 flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
          Receiver URL
        </span>
        <input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="https://your-receiver.example"
          inputMode="url"
          aria-label="Receiver URL"
          className="w-full border border-border bg-surface-container-lowest px-2 py-1 text-[11px] text-on-surface outline-none focus:border-2 focus:border-primary"
        />
      </label>

      {config.frequencies && config.frequencies.length > 0 && (
        <div className="mb-3 border border-border bg-surface-container p-2.5">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
            Frequencies <span className="text-muted">· MHz</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            {config.frequencies.map((f) => (
              <div key={f.label} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-muted">{f.label}</span>
                <span className="shrink-0 font-mono tabular-nums text-on-surface">{f.mhz}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {server.trim() ? (
        <div className="flex flex-col gap-3">
          {channels.map((c) => (
            <div key={c.role} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-on-surface-variant">{c.label}</span>
                <input
                  value={c.channel}
                  onChange={(e) => setChannel(c.role, e.target.value)}
                  placeholder={`channel name (e.g. ${c.label})`}
                  aria-label={`${c.label} channel name`}
                  className="min-w-0 flex-1 border border-border bg-surface-container-lowest px-2 py-1 text-[11px] text-on-surface outline-none focus:border-2 focus:border-primary"
                />
              </div>
              {c.channel.trim() && (
                <SdrChannel
                  server={server}
                  channel={c.channel}
                  role={c.role}
                  label={c.label}
                  active={activeRole === c.role}
                  onPlaying={onPlaying}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted">Add your receiver URL above to list its channels.</p>
      )}

      {activeRole && (
        <div className="mt-3 border border-border bg-surface-container p-2.5">
          <div className="text-xs font-semibold text-on-surface">
            {ROLE_LABEL[activeRole]}{" "}
            <span className="font-normal text-on-surface-variant">
              · active {activeEnds.length ? activeEnds.join(" · ") : "—"}
            </span>
          </div>

          <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
            On frequency now
          </div>
          {candidates.length === 0 ? (
            <p className="mt-0.5 text-[11px] text-muted">No matching traffic right now.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {candidates.map((c) => (
                <li key={c.hex}>
                  <button
                    onClick={() => onSelect?.(c.hex)}
                    className="flex w-full items-center gap-2 px-1 py-0.5 text-left text-xs hover:bg-surface-container-high"
                  >
                    <span aria-hidden className="text-on-surface-variant">
                      {c.kind === "arrival" ? <LandingIcon size={13} /> : <TakeoffIcon size={13} />}
                    </span>
                    <span className="font-mono text-on-surface">{c.callsign}</span>
                    <span className="text-status-arrival" title={`Runway ${c.end}`}>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                        RWY
                      </span>{" "}
                      {c.end}
                    </span>
                    <span className="ml-auto tabular-nums text-muted">
                      {candidateNote(c, now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        Audio comes from an <span className="font-medium">airport-sdr</span> receiver — anyone with
        an antenna and an RTL-SDR/LimeSDR can run one and paste its URL. Each channel plays straight
        from that receiver, which must allow-list this site’s origin or the frame won’t connect.
        Callsigns aren’t in the audio, so the active runways and “on frequency” list are inferred
        from ADS-B — a best guess. The Zurich demo is a hobby receiver and isn’t always reachable.
        Frequencies are OurAirports reference values — confirm against current charts.
      </p>
    </div>
  );
}
