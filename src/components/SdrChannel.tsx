import { useEffect, useRef, useState } from "react";
import type { AtcRole } from "../data/atcFeeds";
import { embedUrl, isSdrMessage, receiverOrigin, sendCommand } from "../lib/airportSdr";

/** How long to wait for the frame's `ready` before calling the receiver unreachable. */
const READY_TIMEOUT_MS = 9000;

type Status = "connecting" | "ready" | "unavailable" | "error";

/** Human line for a terminal error code from the receiver. */
function errorText(code?: string, message?: string): string {
  switch (code) {
    case "origin-not-allowed":
      return "This site isn’t allow-listed on the receiver — its operator must add this origin.";
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
 * One embedded airport-sdr channel. The receiver's compact `<iframe>` player is the
 * display — it carries the channel name, frequency, carrier dot, listener count and its
 * own play/stop — so we add no chrome of our own while it's live, only a line for the
 * states the frame can't show: connecting, unreachable/not-allow-listed, or a reported
 * error. We watch its postMessage events to keep a single channel active and to know
 * which position is playing; a missing `ready` means the receiver is unavailable.
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
  const [err, setErr] = useState<{ code?: string; message?: string }>({});

  const origin = receiverOrigin(server);
  const src = origin ? embedUrl(server, channel, window.location.origin) : null;

  // Listen for this frame's events (validated by origin + source window + protocol).
  // squelch/level/listeners are shown by the frame itself, so we ignore them here.
  useEffect(() => {
    if (!origin) return;
    setStatus("connecting");
    setErr({});

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return;
      if (!isSdrMessage(e.data)) return;
      const m = e.data;
      switch (m.type) {
        case "ready":
          setStatus("ready");
          break;
        case "state":
          if (m.playing) setStatus("ready");
          onPlaying(role, !!m.playing);
          break;
        case "error":
          setStatus("error");
          setErr({ code: m.code, message: m.message });
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
    return <p className="text-[11px] text-status-alert">That receiver URL isn’t valid.</p>;
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
      {status !== "ready" && (
        <p className={`text-[11px] ${status === "connecting" ? "text-muted" : "text-status-alert"}`}>
          {status === "connecting"
            ? "Connecting to receiver…"
            : status === "unavailable"
              ? "Receiver offline, unreachable, or this site isn’t allow-listed."
              : errorText(err.code, err.message)}
        </p>
      )}
    </div>
  );
}
