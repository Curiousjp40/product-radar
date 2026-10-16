// Part A.3 (2026-10-16): "Ocultar los que ya tengo" toggle on Todos/
// "Everything else this week" -- default ON, synced like everything else.
import { pullSynced, readLocal, writeSynced } from "./syncedStorage";

const KEY = "hide_owned_toggle";

export async function getHideOwnedPref(): Promise<boolean> {
  const local = readLocal<boolean | null>(KEY, null);
  const fallback = local === null ? true : local; // default ON
  return pullSynced<boolean>(KEY, fallback);
}

export function setHideOwnedPref(value: boolean): void {
  writeSynced(KEY, value);
}
