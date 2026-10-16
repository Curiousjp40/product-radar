// Part C5's cross-device sync: Roxie uses her phone and we use the
// computer, so Mis Productos (and now No me interesa/Mi lista/hidden
// categories/mark-as-filmed) can't live only in one browser's localStorage.
// This wraps a localStorage key with the Worker's generic /state route:
// every write saves to localStorage immediately (so the UI never waits on a
// network round trip) and pushes to the Worker in the background; every
// read pulls from the Worker first (so a second device sees the latest
// data) and falls back to localStorage when offline or the Worker's
// unreachable.
import { getStoredPassword, setStoredPassword } from "./searchPassword";
import { t, getLang } from "./i18n";

const WORKER_URL = "https://product-radar-search.roxie-radar.workers.dev";

// Future-proofing for multiple users (2026-10-16): every synced key is
// namespaced by profile on the Worker side (state:<profileId>:<key>, see
// worker/src/index.js's handleState) so a real login system can be added
// later without re-keying anything already synced. Roxie is the only
// profile for now -- still gated by the one shared password, no accounts
// yet -- so this is just a fixed id, not read from anywhere per-user.
const PROFILE_ID = "roxie";

export type SyncedKey = "mis_productos" | "not_for_me" | "mi_lista" | "hidden_categories" | "earnings_goal" | "hide_owned_toggle";

export const SYNCED_KEYS: SyncedKey[] = [
  "mis_productos",
  "not_for_me",
  "mi_lista",
  "hidden_categories",
  "earnings_goal",
  "hide_owned_toggle",
];

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
 * Call this once per view render, before reading local state.
 *
 * Privacy fix (2026-10-16): GET /state now requires the same password as
 * writes (sent as a header, never the URL -- see worker/src/index.js's
 * hasValidPassword). Without a stored password this never even calls the
 * Worker: it returns `fallback` (or whatever's cached in THIS browser's
 * own localStorage from before, never another device's data), so a
 * visitor who's never entered the password sees only the plain shared
 * product lists, with no owned/hidden/goal data layered on top. */
export async function pullSynced<T>(key: SyncedKey, fallback: T): Promise<T> {
  const password = getStoredPassword();
  if (!WORKER_URL || !password) return readLocal(key, fallback);
  try {
    const resp = await fetch(`${WORKER_URL}/state?key=${key}&profile=${PROFILE_ID}`, {
      headers: { "X-Sync-Password": password },
    });
    if (resp.status === 401) {
      setStoredPassword(null);
      return readLocal(key, fallback);
    }
    if (!resp.ok) return readLocal(key, fallback);
    const body = await resp.json();
    if (body?.data === null || body?.data === undefined) return readLocal(key, fallback);
    writeLocal(key, body.data as T);
    return body.data as T;
  } catch {
    return readLocal(key, fallback);
  }
}

function pushToWorker<T>(key: SyncedKey, value: T, password: string): Promise<Response> {
  return fetch(`${WORKER_URL}/state?key=${key}&profile=${PROFILE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, data: value }),
  });
}

// Sync gap #2 (2026-10-16): writeSynced used to silently skip the Worker
// push when no password was stored yet, so a change on a device that had
// never run "Buscar cuenta" only ever saved locally -- she'd have no idea
// it wasn't syncing. Now it prompts for the password right then, once per
// page load (further writes this same visit reuse whatever she entered,
// or just stay local-only if she dismissed the prompt, rather than
// re-nagging on every single click).
let promptedForPasswordThisSession = false;

function promptForPasswordOnce(): string | null {
  if (promptedForPasswordThisSession) return getStoredPassword();
  promptedForPasswordThisSession = true;
  // window.prompt throws rather than returning null in some contexts
  // (sandboxed iframes, certain embedded/automated browsers) -- never let
  // that take down the write it's guarding.
  try {
    const entered = window.prompt(t("sync_enter_password_prompt", getLang()));
    if (!entered) return null;
    setStoredPassword(entered);
    return entered;
  } catch {
    return null;
  }
}

/** Writes locally (immediately) and pushes to the Worker in the
 * background (best-effort -- a failed push just means this device's copy
 * leads until the next successful push or pull). Prompts for the shared
 * password once per page load if none is stored yet, instead of silently
 * staying device-local. A 401 (wrong/stale password) clears the stored
 * password so the next write re-prompts. */
export function writeSynced<T>(key: SyncedKey, value: T): void {
  writeLocal(key, value);
  if (!WORKER_URL) return;
  const password = getStoredPassword() ?? promptForPasswordOnce();
  if (!password) return;
  void pushToWorker(key, value, password)
    .then((resp) => {
      if (resp.status === 401) setStoredPassword(null);
    })
    .catch(() => {
      // offline or Worker unreachable -- localStorage already has it
    });
}

/** Sync gaps #3 (2026-10-16): true once a password is stored, meaning this
 * device pushes (and pulls) synced data instead of staying local-only.
 * Doesn't guarantee the LAST push succeeded (that's best-effort, see
 * writeSynced) -- it's "this device is set up to sync," the header
 * indicator's "Sincronizado" state. */
export function isSyncLinked(): boolean {
  return getStoredPassword() !== null;
}

/** Tapping the header's "Solo en este telefono" indicator: prompts for the
 * password (even if promptForPasswordOnce already fired this visit -- this
 * is an explicit request, not an incidental write) and, once entered,
 * eagerly pushes every synced key's current local value so this device's
 * existing history reaches the server immediately rather than waiting for
 * her next edit. Returns true once a password is stored (not proof the
 * push succeeded -- same best-effort contract as writeSynced). */
export async function linkDeviceForSync(): Promise<boolean> {
  let entered: string | null;
  try {
    entered = window.prompt(t("sync_enter_password_prompt", getLang()));
  } catch {
    entered = null;
  }
  if (!entered) return false;
  setStoredPassword(entered);
  promptedForPasswordThisSession = true;
  if (WORKER_URL) {
    for (const key of SYNCED_KEYS) {
      const value = readLocal<unknown>(key, null);
      if (value !== null) {
        try {
          const resp = await pushToWorker(key, value, entered);
          if (resp.status === 401) {
            setStoredPassword(null);
            return false;
          }
        } catch {
          // offline -- she's still "linked" (password stored), it'll sync later
        }
      }
    }
  }
  return true;
}
