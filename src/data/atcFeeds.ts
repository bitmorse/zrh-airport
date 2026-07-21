/**
 * ATC positions (frequencies/roles). A channel maps to a *role*, not a runway —
 * one Tower frequency serves whatever runways are active.
 *
 * Audio comes from an `airport-sdr` receiver: anyone with an antenna and an
 * RTL-SDR/LimeSDR can run one and paste its URL here. We bundle no third-party
 * feeds; only a demo receiver's default is shipped (see DEMO_RECEIVERS).
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

/** A receiver's base URL plus the channel name each position maps to on it. */
export interface ReceiverConfig {
  /** airport-sdr receiver base URL, e.g. "https://receiver.example". */
  server: string;
  /** Per-role channel name as it exists on that receiver (the /embed/<name> segment). */
  channels: Partial<Record<AtcRole, string>>;
}

/**
 * Demo receivers shipped as defaults, keyed by airport ICAO. The Zurich demo is a
 * hobby receiver on a Tailscale host — it is only reachable to some visitors and is
 * not always up, so the panel must fail gracefully. Only the Tower channel exists.
 */
export const DEMO_RECEIVERS: Record<string, ReceiverConfig> = {
  LSZH: {
    server: "https://ridge.tailed0c2.ts.net",
    channels: { tower: "Tower" },
  },
};
