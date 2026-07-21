import { useEffect, useRef, useState } from "react";
import { useAtcFeeds } from "../hooks/useAtcFeeds";
import { embedUrl, isSdrMessage, receiverOrigin, sendCommand } from "../lib/airportSdr";

/**
 * Main-page ATC comms box. When a receiver + Tower channel is configured it mounts the
 * receiver's widget, but only reveals the box once the receiver is reachable (has sent
 * `ready`) — an offline/unreachable receiver stays invisible rather than showing a dead
 * frame. The frame is kept mounted (parked off-screen) while it connects so it can report
 * ready; media in a `display:none` frame would be suspended, so we move it off-screen
 * instead. While `active` (speaker on, settings panel closed) it auto-starts Tower and
 * stops it when the speaker goes off; the widget's own controls handle the rest.
 */
export function AtcComms({ icao, active }: { icao: string; active: boolean }) {
  const { server, channels } = useAtcFeeds(icao);
  const channel = channels.find((c) => c.role === "tower")?.channel.trim() ?? "";
  const origin = receiverOrigin(server);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [reachable, setReachable] = useState(false);

  // The receiver is reachable once its frame reports `ready` (validated by origin + source).
  useEffect(() => {
    if (!origin || !channel) return;
    setReachable(false);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return;
      if (isSdrMessage(e.data) && e.data.type === "ready") setReachable(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, channel]);

  // Autoplay: play/pause on speaker (`active`) or reachability changes. This fires only on
  // those transitions, so the widget's own play/stop stands between them (no fighting).
  // The unmute tap that flips `active` is the gesture the autoplay policy needs.
  useEffect(() => {
    if (!reachable || !origin) return;
    const win = frameRef.current?.contentWindow;
    if (win) sendCommand(win, origin, { type: active ? "play" : "pause" });
  }, [active, reachable, origin]);

  if (!origin || !channel) return null;

  return (
    <div
      className={
        reachable
          ? "border border-border bg-surface-container-low p-4"
          : "pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0"
      }
      aria-hidden={!reachable}
    >
      <h2
        className="mb-2 text-[11px] font-medium uppercase tracking-wide text-on-surface-variant"
        style={reachable ? undefined : { display: "none" }}
      >
        ATC comms · Tower
      </h2>
      <div className="flex justify-center">
        <iframe
          ref={frameRef}
          src={embedUrl(server, channel, window.location.origin)}
          title="Tower comms"
          allow="autoplay"
          width={230}
          height={48}
          className="max-w-full border border-border bg-surface-container-lowest"
        />
      </div>
    </div>
  );
}
