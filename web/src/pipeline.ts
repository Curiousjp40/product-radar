import type { PipelineStatusName } from "./types";

/** Phase 0a placeholder: status/feedback live in this browser's localStorage.
 * Phase 4 replaces this with calls to a Cloudflare Pages Function backed by
 * D1 (spec section 10.4) so status is shared across devices -- same shape,
 * different storage, so views don't need to change when that lands. */
const STATUS_KEY = "product-radar:pipeline";
const FEEDBACK_KEY = "product-radar:feedback";

type StatusMap = Record<string, PipelineStatusName>;

function readMap(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore (private browsing, storage disabled, etc.)
  }
}

export function getStatus(productId: string): PipelineStatusName | undefined {
  return (readMap(STATUS_KEY) as StatusMap)[productId];
}

export function setStatus(productId: string, status: PipelineStatusName): void {
  const map = readMap(STATUS_KEY);
  map[productId] = status;
  writeMap(STATUS_KEY, map);
}

export function getAllStatuses(): StatusMap {
  return readMap(STATUS_KEY) as StatusMap;
}

export function setFeedback(productId: string, signal: "not_for_me" | "love_it"): void {
  const map = readMap(FEEDBACK_KEY);
  map[productId] = signal;
  writeMap(FEEDBACK_KEY, map);
}

export function getFeedback(productId: string): string | undefined {
  return readMap(FEEDBACK_KEY)[productId];
}
