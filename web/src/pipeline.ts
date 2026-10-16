import type { PipelineStatusName } from "./types";
import { pullSynced, readLocal, writeSynced } from "./syncedStorage";

/** Shortlist status ("Mi lista"/"mark as filmed"/etc, synced key
 * "mi_lista") and "No me interesa"/"love it" feedback (synced key
 * "not_for_me") -- previously one localStorage-only combined map (sync
 * gap #1, fixed 2026-10-16), now two synced maps reusing the Worker's two
 * already-reserved key names (worker/src/index.js's STATE_ALLOWED_KEYS),
 * since they were plainly meant for exactly this. Every write still lands
 * in localStorage immediately (syncedStorage.writeSynced), so nothing
 * waits on a network round trip. */

type StatusMap = Record<string, PipelineStatusName>;
type FeedbackMap = Record<string, string>;

const OLD_PIPELINE_KEY = "product-radar:pipeline";
const OLD_HIDDEN_CATEGORIES_KEY = "product-radar:hidden-categories";
const MIGRATION_FLAG_KEY = "product-radar:pipeline-sync-migrated-v1";

let statusCache: StatusMap | null = null;
let feedbackCache: FeedbackMap | null = null;
let migrated: Promise<void> | null = null;

/** One-time migration (per browser) of the old combined localStorage-only
 * pipeline map and the old hidden-categories list onto synced storage, so
 * whatever she already marked on this device before this change reaches
 * the other one instead of silently staying stuck here. Merges with
 * whatever's already synced (server wins on conflict) rather than
 * overwriting it. Guarded by a flag so it only ever runs once. */
function ensureMigrated(): Promise<void> {
  if (!migrated) migrated = runMigration();
  return migrated;
}

async function runMigration(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) return;
  localStorage.setItem(MIGRATION_FLAG_KEY, "1"); // set first so a slow pull can't re-trigger this

  try {
    const raw = localStorage.getItem(OLD_PIPELINE_KEY);
    if (raw) {
      const parsed: Record<string, { status?: PipelineStatusName; feedback?: string }> = JSON.parse(raw);
      const oldStatus: StatusMap = {};
      const oldFeedback: FeedbackMap = {};
      for (const [id, entry] of Object.entries(parsed)) {
        if (entry.status) oldStatus[id] = entry.status;
        if (entry.feedback) oldFeedback[id] = entry.feedback;
      }
      if (Object.keys(oldStatus).length > 0) {
        const current = await pullSynced<StatusMap>("mi_lista", {});
        writeSynced("mi_lista", { ...oldStatus, ...current });
      }
      if (Object.keys(oldFeedback).length > 0) {
        const current = await pullSynced<FeedbackMap>("not_for_me", {});
        writeSynced("not_for_me", { ...oldFeedback, ...current });
      }
    }
  } catch {
    // malformed/missing old data -- nothing to migrate
  }

  try {
    const rawHidden = localStorage.getItem(OLD_HIDDEN_CATEGORIES_KEY);
    const parsedHidden: unknown = rawHidden ? JSON.parse(rawHidden) : [];
    const oldHidden = Array.isArray(parsedHidden) ? (parsedHidden as string[]) : [];
    if (oldHidden.length > 0) {
      const current = await pullSynced<string[]>("hidden_categories", []);
      writeSynced("hidden_categories", [...new Set([...oldHidden, ...current])]);
    }
  } catch {
    // malformed/missing old data -- nothing to migrate
  }
}

async function loadStatusMap(): Promise<StatusMap> {
  await ensureMigrated();
  if (statusCache) return statusCache;
  statusCache = await pullSynced<StatusMap>("mi_lista", readLocal("mi_lista", {}));
  return statusCache;
}

function saveStatusMap(map: StatusMap): void {
  statusCache = map;
  writeSynced("mi_lista", map);
}

async function loadFeedbackMap(): Promise<FeedbackMap> {
  await ensureMigrated();
  if (feedbackCache) return feedbackCache;
  feedbackCache = await pullSynced<FeedbackMap>("not_for_me", readLocal("not_for_me", {}));
  return feedbackCache;
}

function saveFeedbackMap(map: FeedbackMap): void {
  feedbackCache = map;
  writeSynced("not_for_me", map);
}

/** Forces the next read to reload from storage (e.g. after another tab wrote). */
export function invalidateCache(): void {
  statusCache = null;
  feedbackCache = null;
}

export async function getStatus(productId: string): Promise<PipelineStatusName | undefined> {
  return (await loadStatusMap())[productId];
}

export async function setStatus(productId: string, status: PipelineStatusName): Promise<void> {
  const map = await loadStatusMap();
  saveStatusMap({ ...map, [productId]: status });
}

export async function getAllStatuses(): Promise<StatusMap> {
  return { ...(await loadStatusMap()) };
}

export async function setFeedback(productId: string, signal: "not_for_me" | "love_it"): Promise<void> {
  const map = await loadFeedbackMap();
  saveFeedbackMap({ ...map, [productId]: signal });
}

export async function getFeedback(productId: string): Promise<string | undefined> {
  return (await loadFeedbackMap())[productId];
}

export async function getAllFeedback(): Promise<FeedbackMap> {
  return { ...(await loadFeedbackMap()) };
}

export async function clearFeedback(productId: string): Promise<void> {
  const map = await loadFeedbackMap();
  if (!(productId in map)) return;
  const updated = { ...map };
  delete updated[productId];
  saveFeedbackMap(updated);
}

// Hidden categories (synced key "hidden_categories"): kept as a
// synchronous read (readLocal, not pullSynced) since it's used without
// awaiting throughout the app (building a Set on every render) -- see
// pullHiddenCategories below for the one place that actually pulls the
// latest from the server.
export function getHiddenCategories(): string[] {
  return readLocal<string[]>("hidden_categories", []);
}

/** Refreshes the local hidden-categories cache from the server (and runs
 * the one-time migration). Call this once at app startup, before any view
 * calls the synchronous getHiddenCategories() above, so a category hidden
 * on her phone is already respected by the time anything renders here. */
export async function pullHiddenCategories(): Promise<string[]> {
  await ensureMigrated();
  return pullSynced<string[]>("hidden_categories", readLocal("hidden_categories", []));
}

export function hideCategory(category: string): void {
  const set = new Set(getHiddenCategories());
  set.add(category);
  writeSynced("hidden_categories", [...set]);
}

export function unhideCategory(category: string): void {
  const set = new Set(getHiddenCategories());
  set.delete(category);
  writeSynced("hidden_categories", [...set]);
}
