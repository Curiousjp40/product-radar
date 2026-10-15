import type { Sample } from "./samplesLogic";

/** Sample tracker storage, saved in this browser's localStorage (Part D,
 * added 2026-10-15) -- same per-browser, try/catch-everywhere pattern as
 * pipeline.ts. All the actual urgency/sort/CSV logic lives in
 * samplesLogic.ts (pure, tested); this file is just CRUD. */

type SampleMap = Record<string, Sample>;

const STORAGE_KEY = "product-radar:samples";

let memory: SampleMap | null = null;

function loadMap(): SampleMap {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    memory = parsed && typeof parsed === "object" ? (parsed as SampleMap) : {};
  } catch {
    memory = {};
  }
  return memory;
}

function saveMap(map: SampleMap): void {
  memory = map;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable (private mode, blocked site data) -- keep the
    // in-memory copy for this visit, the page still works either way.
  }
}

export function getAllSamples(): Sample[] {
  return Object.values(loadMap());
}

export function upsertSample(sample: Sample): void {
  const map = loadMap();
  map[sample.id] = sample;
  saveMap(map);
}

export function deleteSample(id: string): void {
  const map = loadMap();
  delete map[id];
  saveMap(map);
}

export function newSampleId(): string {
  return `sample_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
