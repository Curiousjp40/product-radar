// Part C6b: saved TikTok account searches, read via the Worker's /saved
// route (free -- see worker/src/index.js's handleSaved). Every successful
// Buscar cuenta search is auto-saved server-side with no expiry; this
// module only reads them back.
import type { AccountSearchResult } from "./types";

const WORKER_URL = "https://product-radar-search.roxie-radar.workers.dev";

export interface SavedSearchSummary {
  handle: string;
  nickname: string;
  avatar: string | null;
  fetched_at: string;
}

export async function listSavedSearches(): Promise<SavedSearchSummary[]> {
  try {
    const resp = await fetch(`${WORKER_URL}/saved`);
    if (!resp.ok) return [];
    const body = await resp.json();
    return Array.isArray(body?.items) ? body.items : [];
  } catch {
    return [];
  }
}

export async function getSavedSearch(handle: string): Promise<AccountSearchResult | null> {
  try {
    const resp = await fetch(`${WORKER_URL}/saved?handle=${encodeURIComponent(handle)}`);
    if (!resp.ok) return null;
    return (await resp.json()) as AccountSearchResult;
  } catch {
    return null;
  }
}
