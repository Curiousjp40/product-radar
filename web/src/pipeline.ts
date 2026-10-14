import type { PipelineStatusName } from "./types";

/** Phase 4 (spec section 10.4): status/feedback are shared across devices via
 * a Cloudflare Pages Function backed by D1 (web/functions/api/status.ts),
 * not per-browser localStorage (the Phase 0a version) -- Roxie and Ryan see
 * the same shortlist. The whole map is fetched once per page load and
 * cached in memory; a write updates the cache immediately (so the UI reacts
 * right away) and posts to the API in the background. */

type StatusEntry = { status?: PipelineStatusName; feedback?: string };
type StatusMap = Record<string, StatusEntry>;

let cache: Promise<StatusMap> | null = null;

async function loadMap(): Promise<StatusMap> {
  if (!cache) {
    cache = fetch("/api/status")
      .then((res) => (res.ok ? (res.json() as Promise<StatusMap>) : {}))
      .catch(() => ({}) as StatusMap);
  }
  return cache;
}

async function postUpdate(productId: string, field: "status" | "feedback", value: string): Promise<void> {
  try {
    await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, field, value }),
    });
  } catch {
    // best-effort -- the in-memory cache is already updated for this
    // session, and the next full page load will re-sync from the API.
  }
}

/** Forces the next read to re-fetch from the API instead of the cache --
 * call this if a status write might have come from another device/tab. */
export function invalidateCache(): void {
  cache = null;
}

export async function getStatus(productId: string): Promise<PipelineStatusName | undefined> {
  const map = await loadMap();
  return map[productId]?.status;
}

export async function setStatus(productId: string, status: PipelineStatusName): Promise<void> {
  const map = await loadMap();
  map[productId] = { ...map[productId], status };
  await postUpdate(productId, "status", status);
}

export async function getAllStatuses(): Promise<Record<string, PipelineStatusName>> {
  const map = await loadMap();
  const out: Record<string, PipelineStatusName> = {};
  for (const [productId, entry] of Object.entries(map)) {
    if (entry.status) out[productId] = entry.status;
  }
  return out;
}

export async function setFeedback(productId: string, signal: "not_for_me" | "love_it"): Promise<void> {
  const map = await loadMap();
  map[productId] = { ...map[productId], feedback: signal };
  await postUpdate(productId, "feedback", signal);
}

export async function getFeedback(productId: string): Promise<string | undefined> {
  const map = await loadMap();
  return map[productId]?.feedback;
}

export async function getAllFeedback(): Promise<Record<string, string>> {
  const map = await loadMap();
  const out: Record<string, string> = {};
  for (const [productId, entry] of Object.entries(map)) {
    if (entry.feedback) out[productId] = entry.feedback;
  }
  return out;
}
