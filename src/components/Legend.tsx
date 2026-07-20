import { HEAT_MAX, HEAT_STEPS } from "../lib/heat";
import { PlaneIcon } from "./icons";

/** Explains the heat scale and the plane-phase colours. */
export function Legend() {
  return (
    <div className="flex flex-col gap-3 text-xs text-on-surface-variant">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-on-surface">
          Aircraft in last 15 min
        </div>
        {/* Discrete stepped swatches (no gradient, per design). */}
        <div
          className="flex h-3 w-full"
          role="img"
          aria-label="Heat scale from grey (no traffic) to red (busy)"
        >
          {HEAT_STEPS.map((c, i) => (
            <span key={i} className="h-full flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>0</span>
          <span>{Math.round(HEAT_MAX / 2)}</span>
          <span>{HEAT_MAX}+</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 uppercase tracking-wide">
        <PhaseKey color="var(--color-status-arrival)" label="Arriving" />
        <PhaseKey color="var(--color-status-runway)" label="On runway" />
        <PhaseKey color="var(--color-status-departure)" label="Departing" />
        <PhaseKey color="var(--color-muted)" label="Other" />
      </div>
    </div>
  );
}

function PhaseKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PlaneIcon size={12} style={{ color }} />
      {label}
    </span>
  );
}
