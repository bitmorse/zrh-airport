import { useSyncExternalStore } from "react";
import {
  getNoiseAudio,
  getNoiseSnapshot,
  relabelNoiseEvent,
  removeNoiseEvent,
  subscribeNoise,
  type NoiseEvent,
} from "../data/noiseStore";

export function useNoiseEvents(): {
  events: NoiseEvent[];
  remove: (id: string) => Promise<void>;
  getAudio: (id: string) => Promise<Blob | undefined>;
  relabel: (id: string, hex: string) => Promise<void>;
} {
  const events = useSyncExternalStore(subscribeNoise, getNoiseSnapshot);
  return {
    events,
    remove: removeNoiseEvent,
    getAudio: getNoiseAudio,
    relabel: relabelNoiseEvent,
  };
}
