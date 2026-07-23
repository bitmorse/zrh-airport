import { classifyQuery } from "../data/flightQuery";

/**
 * URL permalinks for deep-linking into the app: `?airport=LSZH` selects an airport for
 * the normal view, and `?flight=LX40` / `?hex=4b1620` / `?reg=HB-JCA` open **follow
 * mode** for that flight ("track my plane" links). The follow value is just the search
 * query; its param name (flight/hex/reg) matches `classifyQuery` so the link reads well.
 */

export interface InitialLink {
  airport: string | null;
  /** Raw follow query (flight number / hex / reg) if the URL asked to track one. */
  followQuery: string | null;
}

export function readInitialLink(search: string = window.location.search): InitialLink {
  const p = new URLSearchParams(search);
  return {
    airport: p.get("airport"),
    followQuery: p.get("flight") ?? p.get("hex") ?? p.get("reg") ?? null,
  };
}

/** Put the current follow target into the address bar so it's copy-paste shareable. */
export function writeFollowLink(query: string): void {
  const params = new URLSearchParams();
  params.set(classifyQuery(query), query); // "flight" | "hex" | "reg"
  replace(`?${params.toString()}`);
}

/** Return to the normal view (optionally keeping the airport selection in the URL). */
export function writeAirportLink(airport: string | null): void {
  replace(airport ? `?airport=${encodeURIComponent(airport)}` : "");
}

function replace(search: string): void {
  const url = window.location.pathname + search + window.location.hash;
  window.history.replaceState(null, "", url);
}
