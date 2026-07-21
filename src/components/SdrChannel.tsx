import { useEffect, useRef, useState } from "react";
import type { AtcRole } from "../data/atcFeeds";
import { embedUrl, isSdrMessage, receiverOrigin, sendCommand } from "../lib/airportSdr";

/** How long to wait for the frame's `ready` before calling the receiver unreachable. */
const READY_TIMEOUT_MS = 9000;

type Status = "connecting" | "ready" | "unavailable" | "error";

interface Meta {
  frequency?: number;
  squelchOpen?: boolean;
  level?: number;
  listeners?: number;
  errorCode?: string;
  errorMessage?: string;
}

/** Human line for a terminal error code from the receiver. */
function errorText(code?: string, message?: string): string {
  switch (code) {
    case "origin-not-allowed":
      return "This site isn't allow-listed on the receiver — its operator must add this origin.";
    case "stream-failed":
      return "Connection to the receiver dropped — retrying…";
    case "insecure-context":
      return "Page is http, so the low-latency path is off — using the slower WAV stream.";
    case "autoplay-blocked":
      return "Playback was blocked — press play in the frame to start.";
    default:
      return message || "The receiver reported an error.";
  }
}

/**
 * One embedded airport-sdr channel: the receiver's compact `<iframe>` player (its own
 * play/stop, name, frequency, carrier dot and listener count) wrapped with a live
 * connection state we derive from its postMessage events. Reports playing changes up so
 * the panel can keep a single channel active and match traffic to the live frequency.
 * If no `ready` arrives (receiver offline, unreachable, or this origin not allow-listed)
 * it degrades to a clear "unavailable" line instead of a dead frame.
 */
export function SdrChannel({
  server,
  channel,
  role,
  label,
  active,
  onPlaying,
}: {
  server: string;
  channel: string;
  role: AtcRole;
  label: string;
  active: boolean;
  onPlaying: (role: AtcRole, playing: boolean) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [meta, setMeta] = useState<Meta>({});

  const origin = receiverOrigin(server);
  const src = origin ? embedUrl(server, channel, window.location.origin) : null;

  // Listen for this frame's events (validated by origin + source window + protocol),
  // and treat a missing `ready` as an unreachable/blocked receiver.
  useEffect(() => {
    if (!origin) return;
    setStatus("connecting");
    setMeta({});

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return;
      if (!isSdrMessage(e.data)) return;
      const m = e.data;
      switch (m.type) {
        case "ready":
          setStatus("ready");
          setMeta((x) => ({ ...x, frequency: m.frequency }));
          break;
        case "state":
          if (m.playing) setStatus("ready");
          onPlaying(role, !!m.playing);
          break;
        case "squelch":
          setMeta((x) => ({ ...x, squelchOpen: m.open }));
          break;
        case "level":
          setMeta((x) => ({ ...x, level: m.db }));
          break;
        case "listeners":
          setMeta((x) => ({ ...x, listeners: m.count }));
          break;
        case "error":
          setStatus("error");
          setMeta((x) => ({ ...x, errorCode: m.code, errorMessage: m.message }));
          onPlaying(role, false);
          break;
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(
      () => setStatus((s) => (s === "connecting" ? "unavailable" : s)),
      READY_TIMEOUT_MS,
    );
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [origin, src, role, onPlaying]);

  // Single-active: when the panel deactivates this channel, pause its frame.
  useEffect(() => {
    if (active || !origin) return;
    const win = frameRef.current?.contentWindow;
    if (win) sendCommand(win, origin, { type: "pause" });
  }, [active, origin]);

  if (!origin) {
    return <p className="text-[11px] text-status-alert">Receiver URL isn't a valid URL.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <iframe
        ref={frameRef}
        src={src ?? undefined}
        width={230}
        height={48}
        allow="autoplay"
        title={`${label} — ${channel}`}
        className="max-w-full border border-border bg-surface-container-lowest"
      />
      <StatusLine status={status} meta={meta} />
    </div>
  );
}

function StatusLine({ status, meta }: { status: Status; meta: Meta }) {
  if (status === "connecting") {
    return <p className="text-[11px] text-muted">Connecting to receiver…</p>;
  }
  if (status === "unavailable") {
    return (
      <p className="text-[11px] text-status-alert">
        Receiver offline, unreachable, or this site isn't allow-listed.
      </p>
    );
  }
  if (status === "error") {
    return <p className="text-[11px] text-status-alert">{errorText(meta.errorCode, meta.errorMessage)}</p>;
  }
  // ready
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
      {meta.frequency != null && (
        <span className="font-mono tabular-nums text-on-surface-variant">
          {meta.frequency.toFixed(3)} MHz
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            meta.squelchOpen ? "bg-status-cleared" : "bg-outline-variant"
          }`}
        />
        {meta.squelchOpen ? "carrier" : "quiet"}
      </span>
      {meta.level != null && (
        <span className="font-mono tabular-nums">{Math.round(meta.level)} dBFS</span>
      )}
      {meta.listeners != null && <span>{meta.listeners} listening</span>}
    </p>
  );
}
