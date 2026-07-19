/**
 * ATC positions (frequencies/roles). A stream maps to a *role*, not a runway —
 * one Tower frequency serves whatever runways are active. Stream URLs are
 * user-provided (bring-your-own): we do not bundle any provider's feeds, since
 * e.g. LiveATC's terms forbid third-party embedding.
 */
export type AtcRole = "approach" | "tower" | "departure" | "ground";

export interface AtcFeed {
  role: AtcRole;
  label: string;
}

/** Standard positions, ordered inbound → outbound, same for every airport. */
export const ATC_ROLES: AtcFeed[] = [
  { role: "approach", label: "Approach" },
  { role: "tower", label: "Tower" },
  { role: "departure", label: "Departure" },
  { role: "ground", label: "Ground" },
];
