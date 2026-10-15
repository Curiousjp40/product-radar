import type { PipelineStatusName } from "./types";

/** Shortlist status and "not for me" feedback, saved in this browser's
 * localStorage. The site is a static GitHub Pages site (no server), so each
 * phone or computer keeps its own list. Every read and write is wrapped in
 * try/catch: storage can be unavailable (private mode, blocked site data),
 * and the page must keep working without it. */

type StatusEntry = { status?: PipelineStatusName; feedback?: string };
type StatusMap = Record<string, StatusEntry>;

const STORAGE_KEY = "product-radar:pipeline";

let memory: StatusMap | null = null;

function loadMap(): StatusMap {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    memory = parsed && typeof parsed === "object" ? (parsed as StatusMap) : {};
  } catch {
    memory = {};
  }
  return memory;
}

function saveMap(map: StatusMap): void {
  memory = map;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable: keep the in-memory copy for this visit
  }
}

/** Forces the next read to reload from storage (e.g. after another tab wrote). */
export function invalidateCache(): void {
  memory = null;
}

export async function getStatus(productId: string): Promise<PipelineStatusName | undefined> {
  return loadMap()[productId]?.status;
}

export async function setStatus(productId: string, status: PipelineStatusName): Promise<void> {
  const map = loadMap();
  map[productId] = { ...map[productId], status };
  saveMap(map);
}

export async function getAllStatuses(): Promise<Record<string, PipelineStatusName>> {
  const out: Record<string, PipelineStatusName> = {};
  for (const [productId, entry] of Object.entries(loadMap())) {
    if (entry.status) out[productId] = entry.status;
  }
  return out;
}

export async function setFeedback(productId: string, signal: "not_for_me" | "love_it"): Promise<void> {
  const map = loadMap();
  map[productId] = { ...map[productId], feedback: signal };
  saveMap(map);
}

export async function getFeedback(productId: string): Promise<string | undefined> {
  return loadMap()[productId]?.feedback;
}

export async function getAllFeedback(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [productId, entry] of Object.entries(loadMap())) {
    if (entry.feedback) out[productId] = entry.feedback;
  }
  return out;
}
