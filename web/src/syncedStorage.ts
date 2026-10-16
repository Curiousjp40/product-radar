// Part C5's cross-device sync: Roxie uses her phone and we use the
// computer, so Mis Productos (and, longer-term, "No me interesa" / "Mi
// lista") can't live only in one browser's localStorage. This wraps a
// localStorage key with the Worker's generic /state route: every write
// saves to localStorage immediately (so the UI never waits on a network
// round trip) and pushes to the Worker in the background; every read
// pulls from the Worker first (so a second device sees the latest data)
// and falls back to localStorage when offline or the Worker's unreachable.
import { getStoredPassword } from "./searchPassword";

const WORKER_URL = "https://product-radar-search.roxie-radar.workers.dev";

export type SyncedKey = "mis_productos" | "not_for_me" | "mi_lista" | "hidden_categories" | "earnings_goal";

function localKey(key: SyncedKey): string {
  return `product-radar:synced:${key}`;
}

export function readLocal<T>(key: SyncedKey, fallback: T): T {
  try {
    const raw = localStorage.getItem(localKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: SyncedKey, value: T): void {
  try {
    localStorage.setItem(localKey(key), JSON.stringify(value));
  } catch {
    // storage unavailable -- the in-memory value from this call still
    // gets pushed to the Worker below, just not cached for next load
  }
}

/** Pulls the latest synced value from the Worker (if reachable) and
 * caches it locally; falls back to whatever's already in localStorage.
 * Call this once per view render, before reading local state. */
export async function pullSynced<T>(key: SyncedKey, fallback: T): Promise<T> {
  if (!WORKER_URL) return readLocal(key, fallback);
  try {
    const resp = await fetch(`${WORKER_URL}/state?key=${key}`);
    if (!resp.ok) return readLocal(key, fallback);
    const body = await resp.json();
    if (body?.data === null || body?.data === undefined) return readLocal(key, fallback);
    writeLocal(key, body.data as T);
    return body.data as T;
  } catch {
    return readLocal(key, fallback);
  }
}

/** Writes locally (immediately) and pushes to the Worker in the
 * background (best-effort -- a failed push just means this device's copy
 * leads until the next successful push or pull). Silently skips the
 * Worker push when no password has been entered yet (e.g. she's only
 * ever used "Mi lista" locally, never Buscar cuenta) -- the local write
 * still happens, so nothing is lost, it just doesn't sync until she
 * enters the password once (same shared prompt as Buscar cuenta). */
export function writeSynced<T>(key: SyncedKey, value: T): void {
  writeLocal(key, value);
  const password = getStoredPassword();
  if (!WORKER_URL || !password) return;
  void fetch(`${WORKER_URL}/state?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, data: value }),
  }).catch(() => {
    // offline or Worker unreachable -- localStorage already has it
  });
}
