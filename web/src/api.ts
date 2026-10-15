import type { CandidatesFile, HooksFile, InsightsFile, MetaFile, PicksFile, ProductDetail, SeasonsFile } from "./types";

/** Tries the real data path first, falls back to the synthetic sample data
 * (Phase 0a has no scoring pipeline yet, so /data/*.json won't exist until
 * Phase 2). Once run.py writes real data, this needs no changes.
 *
 * Parses the response as JSON ourselves rather than trusting `res.ok`: both
 * the Vite dev server and most static hosts' SPA fallback return 200 with
 * index.html for any unmatched path, which would otherwise look like a
 * successful "real data" load. */
async function loadJson<T>(path: string): Promise<{ data: T; isSample: boolean }> {
  try {
    const real = await fetch(`./data/${path}`);
    if (real.ok) {
      const text = await real.text();
      try {
        return { data: JSON.parse(text) as T, isSample: false };
      } catch {
        // SPA fallback HTML, not real data -- fall through to sample
      }
    }
  } catch {
    // network error -- fall through to sample
  }
  const sample = await fetch(`./data/sample/${path}`);
  if (!sample.ok) {
    throw new Error(`failed to load ${path} (no real or sample data)`);
  }
  return { data: (await sample.json()) as T, isSample: true };
}

export const loadPicks = () => loadJson<PicksFile>("picks.json");
export const loadCandidates = () => loadJson<CandidatesFile>("candidates.json");
export const loadInsights = () => loadJson<InsightsFile>("insights.json");
export const loadSeasons = () => loadJson<SeasonsFile>("seasons.json");
export const loadMeta = () => loadJson<MetaFile>("meta.json");
export const loadProduct = (productId: string) => loadJson<ProductDetail>(`products/${productId}.json`);
export const loadHooks = () => loadJson<HooksFile>("hooks.json");
