import { useSyncExternalStore } from "react";
import {
  getNoiseAudio,
  getNoiseSnapshot,
  removeNoiseEvent,
  subscribeNoise,
  type NoiseEvent,
} from "../data/noiseStore";

export function useNoiseEvents(): {
  events: NoiseEvent[];
  remove: (id: string) => Promise<void>;
  getAudio: (id: string) => Promise<Blob | undefined>;
} {
  const events = useSyncExternalStore(subscribeNoise, getNoiseSnapshot);
  return { events, remove: removeNoiseEvent, getAudio: getNoiseAudio };
}
