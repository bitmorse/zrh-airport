import { useSyncExternalStore } from "react";
import {
  getWatchedSnapshot,
  removeWatch,
  subscribeWatched,
} from "../data/watchStore";

/** Live view of the offline "watched flights" store, with a remove action. */
export function useWatchedFlights() {
  const watched = useSyncExternalStore(subscribeWatched, getWatchedSnapshot);
  return { watched, remove: removeWatch };
}
