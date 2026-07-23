import { useState } from "react";
import type { TrackedFlight } from "../hooks/useTrackedFlight";
import { useNow } from "../hooks/useNow";
import { useSettings } from "../hooks/useSettings";
import { etaToDestination, humanDuration, localHhmm } from "../lib/flightEta";
import { formatAltitude, formatSpeed } from "../lib/format";
import { CloseIcon, ExternalLinkIcon } from "./icons";

interface Phase {
  label: string;
  cls: string;
}

function phaseOf(t: TrackedFlight): Phase {
  if (t.status === "searching") return { label: "Searching…", cls: "bg-surface-container text-on-surface-variant" };
  if (t.status === "lost") return { label: "Signal lost", cls: "bg-surface-container text-status-alert" };
  const ac = t.aircraft;
  if (ac?.onGround) return { label: "On ground", cls: "bg-surface-container text-on-surface-variant" };
  const vr = ac?.verticalRateFpm ?? 0;
  if (vr > 200) return { label: "Climbing", cls: "bg-status-departure text-on-primary" };
  if (vr < -200) return { label: "Descending", cls: "bg-status-arrival text-on-primary" };
  return { label: "En route", cls: "bg-status-cleared text-on-primary" };
}

/**
 * The tracked-flight card (follow mode): a flight-status style readout — a phase pill,
 * the flight number + aircraft type, a timing headline (ETA to destination from live
 * groundspeed), the airline + registration, and an origin→dest strip. Plus Copy link /
 * Exit. Shows a searching state until the aircraft is found.
 */
export function FlightReadout({ tracked, onExit }: { tracked: TrackedFlight; onExit: () => void }) {
  const [{ units }] = useSettings();
  const now = useNow(1000);
  const [copied, setCopied] = useState(false);

  const { aircraft: ac, route } = tracked;
  const phase = phaseOf(tracked);
  const flightNo = route?.flightIata ?? tracked.callsign ?? "—";
  const type = ac?.type ?? null;
  const origin = route?.origin ?? null;
  const dest = route?.destination ?? null;

  // ETA to destination from current position + groundspeed + great-circle distance.
  const eta = etaToDestination(ac, dest, now);
  const etaText = eta ? humanDuration(eta.etaSec) : null;
  const destTime = eta ? localHhmm(eta.arriveAtMs) : null;

  const headline =
    tracked.status === "searching"
      ? "Looking for this flight…"
      : tracked.status === "lost"
        ? "Off the feed — waiting for a signal"
        : etaText && dest
          ? `Arrives ${dest.iata ?? dest.icao ?? ""} in ${etaText}`
          : ac?.onGround
            ? "On the ground"
            : ac
              ? `${ac.altFt != null ? formatAltitude(ac.altFt, units) : "—"} · ${ac.gs != null ? formatSpeed(ac.gs, units) : "—"}`
              : "—";

  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="border border-border bg-surface-container-low p-4">
      {/* Top: phase pill · flight number + type. */}
      <div className="flex items-start justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${phase.cls}`}>
          {phase.label}
        </span>
        <div className="text-right">
          <div className="font-mono text-base font-semibold text-on-surface">{flightNo}</div>
          {type && <div className="text-[11px] text-muted">{type}</div>}
        </div>
      </div>

      {/* Headline: the timing. */}
      <h2 className="mt-2 text-lg font-semibold leading-tight text-on-surface">{headline}</h2>

      {/* Sub: airline · registration. */}
      <p className="mt-0.5 text-xs text-muted">
        {[route?.airlineName, ac?.registration].filter(Boolean).join(" · ") || "Airline unknown"}
      </p>

      {/* Origin → destination strip. */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2 font-mono">
        <div>
          <span className="text-base font-semibold text-on-surface">{origin?.iata ?? origin?.icao ?? "—"}</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-on-surface-variant">
          <span className="h-px flex-1 bg-border" />
          <span aria-hidden className="px-2">✈</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="text-right">
          {destTime && <span className="mr-1 text-sm text-status-cleared">{destTime}</span>}
          <span className="text-base font-semibold text-on-surface">{dest?.iata ?? dest?.icao ?? "—"}</span>
        </div>
      </div>

      {/* Actions. */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 border border-border px-2 py-1 text-xs uppercase text-on-surface-variant hover:bg-surface-container"
        >
          <ExternalLinkIcon size={13} /> {copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 border border-border px-2 py-1 text-xs uppercase text-on-surface-variant hover:bg-surface-container"
        >
          <CloseIcon size={13} /> Exit
        </button>
      </div>
    </div>
  );
}
