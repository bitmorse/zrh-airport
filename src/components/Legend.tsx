import { HEAT_MAX, heatGradientCss } from "../lib/heat";

/** Explains the heat scale and the plane-phase colours. */
export function Legend() {
  return (
    <div className="flex flex-col gap-3 text-xs text-slate-300">
      <div>
        <div className="mb-1 font-semibold text-slate-200">
          Aircraft in last 15 min
        </div>
        <div
          className="h-3 w-full rounded"
          style={{ background: heatGradientCss() }}
          role="img"
          aria-label="Heat scale from grey (no traffic) to red (busy)"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>0</span>
          <span>{Math.round(HEAT_MAX / 2)}</span>
          <span>{HEAT_MAX}+</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <PhaseKey color="#38bdf8" label="Arriving" />
        <PhaseKey color="#e5e7eb" label="On runway" />
        <PhaseKey color="#fbbf24" label="Departing" />
        <PhaseKey color="#64748b" label="Other" />
      </div>
    </div>
  );
}

function PhaseKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={12} height={12} viewBox="-6 -8 12 16" aria-hidden>
        <path
          d="M0,-7 L2.2,-1 L2.2,1.5 L0,0.5 L-2.2,1.5 L-2.2,-1 Z M0,0.5 L1.6,4 L1.6,5 L0,4.2 L-1.6,5 L-1.6,4 Z"
          fill={color}
        />
      </svg>
      {label}
    </span>
  );
}
