import { useCallback, useEffect, useRef, useState } from "react";
import type { AtcRole } from "../data/atcFeeds";

/**
 * Plays a single ATC stream at a time via a plain <audio> element (cross-origin
 * playback needs no CORS; reading samples would, which we avoid). Also holds the
 * user's estimate of the stream's buffering delay, used to line the audio up with
 * the near-real-time traffic view.
 */
export interface AtcPlayer {
  playingRole: AtcRole | null;
  error: string | null;
  /** Estimated stream delay in seconds (ATC feeds typically lag ~20–40 s). */
  delaySec: number;
  setDelaySec: (s: number) => void;
  toggle: (role: AtcRole, url: string) => void;
  stop: () => void;
}

export function useAtcPlayer(): AtcPlayer {
  const [playingRole, setPlayingRole] = useState<AtcRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delaySec, setDelaySec] = useState(30);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setPlayingRole(null);
  }, []);

  const toggle = useCallback(
    (role: AtcRole, url: string) => {
      if (playingRole === role) {
        stop();
        return;
      }
      setError(null);
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.preload = "none";
      }
      const a = audioRef.current;
      a.onerror = () => {
        setError("Stream unavailable — check the URL (some feeds block hotlinking).");
        setPlayingRole(null);
      };
      a.src = url;
      void a
        .play()
        .then(() => {
          setPlayingRole(role);
          setError(null);
        })
        .catch(() => {
          setError("Couldn’t start playback.");
          setPlayingRole(null);
        });
    },
    [playingRole, stop],
  );

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  return { playingRole, error, delaySec, setDelaySec, toggle, stop };
}
