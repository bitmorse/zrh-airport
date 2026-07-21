/**
 * airport-sdr embed protocol (postMessage). The receiver hands out a compact iframe
 * player at `/embed/<channel>?origin=<us>`; it and the host page exchange messages
 * that all carry `source: "airport-sdr"` and `protocol: 1`. We validate both, plus the
 * message's origin and its source window, before trusting anything — the frame is
 * cross-origin and other actors post to `window` freely.
 */
export const SDR_SOURCE = "airport-sdr";
export const SDR_PROTOCOL = 1;

/** The receiver's origin (scheme+host+port) for a base URL, or null if it isn't a URL. */
export function receiverOrigin(server: string): string | null {
  try {
    return new URL(server).origin;
  } catch {
    return null;
  }
}

/** The embed URL for one channel, telling the receiver our origin so it can message us. */
export function embedUrl(server: string, channel: string, pageOrigin: string): string {
  const base = server.replace(/\/+$/, "");
  return `${base}/embed/${encodeURIComponent(channel)}?origin=${encodeURIComponent(pageOrigin)}`;
}

/** Commands the host sends into the frame. */
export type SdrCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "setVolume"; value: number }
  | { type: "getState" };

/** Events the frame sends back (fields we read; others are ignored). */
export interface SdrMessage {
  source: typeof SDR_SOURCE;
  protocol: number;
  type: "ready" | "state" | "squelch" | "level" | "listeners" | "error";
  // ready
  channel?: string;
  frequency?: number;
  // state
  playing?: boolean;
  muted?: boolean;
  volume?: number;
  // squelch
  open?: boolean;
  // level
  db?: number;
  // listeners
  count?: number;
  // error
  code?: string;
  message?: string;
}

/** Shape guard: is this a message from an airport-sdr player (not stray window noise)? */
export function isSdrMessage(data: unknown): data is SdrMessage {
  const m = data as SdrMessage | null;
  return !!m && m.source === SDR_SOURCE && m.protocol === SDR_PROTOCOL && typeof m.type === "string";
}

/** Post a command to a frame's window at the receiver's origin (never "*"). */
export function sendCommand(win: Window, origin: string, cmd: SdrCommand): void {
  win.postMessage({ source: SDR_SOURCE, protocol: SDR_PROTOCOL, ...cmd }, origin);
}
