// Part C6b: saved TikTok account searches, read via the Worker's /saved
// route. Every successful Buscar cuenta search is auto-saved server-side
// with no expiry; this module only reads them back.
//
// Privacy fix (2026-10-16): /saved is Roxie's own research history (real
// account data on who she's scouted), now password-gated
// (worker/src/index.js's handleSaved) -- never calls the Worker without a
// stored password, so a visitor who hasn't connected sees an empty list
// rather than her real one.
import { getStoredPassword, setStoredPassword } from "./searchPassword";
import type { AccountSearchResult } from "./types";

const WORKER_URL = "https://product-radar-search.roxie-radar.workers.dev";

export interface SavedSearchSummary {
  handle: string;
  nickname: string;
  avatar: string | null;
  fetched_at: string;
}

export async function listSavedSearches(): Promise<SavedSearchSummary[]> {
  const password = getStoredPassword();
  if (!password) return [];
  try {
    const resp = await fetch(`${WORKER_URL}/saved`, { headers: { "X-Sync-Password": password } });
    if (resp.status === 401) {
      setStoredPassword(null);
      return [];
    }
    if (!resp.ok) return [];
    const body = await resp.json();
    return Array.isArray(body?.items) ? body.items : [];
  } catch {
    return [];
  }
}

export async function getSavedSearch(handle: string): Promise<AccountSearchResult | null> {
  const password = getStoredPassword();
  if (!password) return null;
  try {
    const resp = await fetch(`${WORKER_URL}/saved?handle=${encodeURIComponent(handle)}`, {
      headers: { "X-Sync-Password": password },
    });
    if (resp.status === 401) {
      setStoredPassword(null);
      return null;
    }
    if (!resp.ok) return null;
    return (await resp.json()) as AccountSearchResult;
  } catch {
    return null;
  }
}
