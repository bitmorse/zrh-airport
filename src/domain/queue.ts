import type { DepartureEvent, DeparturePhase } from "./departures";
import type { Arrival } from "./predictions";

/**
 * Tunables for the traffic board's arrival/departure queues — the single place to tweak
 * "how far out we consider" and how long the queues can grow. `arrivalHorizonS` is the
 * one knob the user reaches for: it is also the ETA cap in `predictions.ts` (imported
 * from here), so the sequence the board shows and the arrivals the predictor emits stay
 * the same set. The geometric approach corridor (`APPROACH_M` in assignRunway.ts) and the
 * feed query radius (`radiusNm` in useSettings.ts) are the outer bounds that must remain
 * ≥ this horizon.
 */
export const QUEUE = {
  /** Arrivals within this ETA (seconds) are "due to land" and enter the queue. ~12 min. */
  arrivalHorizonS: 12 * 60,
  /** Max rows shown per side (arrivals / departures) before collapsing to "+N more". */
  maxRows: 6,
} as const;

/**
 * Departure lineup order (front of the queue first): the aircraft cleared and rolling is
 * on the runway now, then those holding at the threshold in the order they arrived (FIFO —
 * the longest wait is next to go), then aircraft already climbing out (kept briefly for
 * continuity after they leave the ground).
 */
const PHASE_RANK: Record<DeparturePhase, number> = { roll: 0, holding: 1, climb: 2 };

function lineupOrder(a: DepartureEvent, b: DepartureEvent): number {
  if (PHASE_RANK[a.phase] !== PHASE_RANK[b.phase]) {
    return PHASE_RANK[a.phase] - PHASE_RANK[b.phase];
  }
  if (a.phase === "holding") {
    // True FIFO: the earliest holdingSinceMs (longest wait) leads; unknown start sorts last.
    return (a.holdingSinceMs ?? Infinity) - (b.holdingSinceMs ?? Infinity);
  }
  // roll / climb: the more-advanced (faster) aircraft leads; nulls last.
  return (b.gsKt ?? -1) - (a.gsKt ?? -1);
}

export interface Queues {
  /** Arrivals due within the horizon, soonest first, capped to `maxRows`. */
  arrivals: Arrival[];
  /** Departures in lineup order, capped to `maxRows`. */
  departures: DepartureEvent[];
  /** Arrivals hidden past the cap → "+N more arriving". */
  arrivalsMore: number;
  /** Departures hidden past the cap → "+N more departing". */
  departuresMore: number;
  /** Selected aircraft that is neither a queued arrival nor a departure (shown once). */
  orphanHex: string | null;
}

/**
 * Build the board's two queues from the live arrival/departure lists. Pure and
 * hook-free so the ordering, horizon and cap are all unit-testable in one place. The
 * selected aircraft is always kept visible: if it's a queued arrival/departure beyond
 * the cap it's rescued into its list; if it's neither, it comes back as `orphanHex` for
 * the board to render a single fallback row.
 */
export function buildQueues({
  arrivals,
  departures,
  selectedHex,
}: {
  arrivals: Arrival[];
  departures: DepartureEvent[];
  selectedHex?: string | null;
}): Queues {
  const { arrivalHorizonS, maxRows } = QUEUE;

  // Arrivals arrive already soonest-first from predictArrivals; keep those due within the
  // horizon. Departures get their lineup order here.
  const dueArrivals = arrivals.filter((a) => a.etaSeconds <= arrivalHorizonS);
  const departuresOrdered = [...departures].sort(lineupOrder);

  // A selected arrival is rescued from the *full* arrivals list (so one further out than
  // the horizon still shows as a proper arrival row); a departure from its ordered list.
  const arr = capWithSelected(dueArrivals, arrivals, maxRows, selectedHex, (a) => a.hex);
  const dep = capWithSelected(departuresOrdered, departuresOrdered, maxRows, selectedHex, (d) => d.hex);

  const shown = new Set<string>([
    ...arr.list.map((a) => a.hex),
    ...dep.list.map((d) => d.hex),
  ]);
  const orphanHex = selectedHex && !shown.has(selectedHex) ? selectedHex : null;

  return {
    arrivals: arr.list,
    departures: dep.list,
    arrivalsMore: arr.more,
    departuresMore: dep.more,
    orphanHex,
  };
}

/**
 * Take the first `max` of an already-ordered `shown` list; if `selectedHex` isn't among
 * them, rescue it from `rescuePool` and append so the selection is never hidden by the
 * cap. `more` counts the horizon-included overflow only — a rescued item that was within
 * the cap-eligible set is not double-counted.
 */
function capWithSelected<T>(
  shown: T[],
  rescuePool: T[],
  max: number,
  selectedHex: string | null | undefined,
  hexOf: (item: T) => string,
): { list: T[]; more: number } {
  const list = shown.slice(0, max);
  let more = shown.length - list.length;
  if (selectedHex && !list.some((i) => hexOf(i) === selectedHex)) {
    const sel = rescuePool.find((i) => hexOf(i) === selectedHex);
    if (sel) {
      list.push(sel);
      if (shown.some((i) => hexOf(i) === selectedHex)) more -= 1; // was a capped horizon item
    }
  }
  return { list, more };
}
