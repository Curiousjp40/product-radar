/** Part 3 "Ya lo tengo" swap (2026-10-16): once a pick is marked owned,
 * Hoy/Esta semana must drop it and backfill the empty slot from the full
 * candidate pool so the list stays at its original size -- same diversity
 * rules as the server's own picks assembly (engine/picks.py), simplified
 * for a client-side, in-memory-only swap: category/shop caps, best-score
 * first. No brand/near-duplicate check here (acceptable client-side
 * approximation -- `pool` is expected pre-sorted best-first by the caller). */
export interface SwapCandidate {
  product_id: string;
  category: string;
  shop_name: string;
}

export function applyOwnedSwap<T extends SwapCandidate>(
  picks: T[],
  pool: T[],
  ownedIds: Set<string>,
  maxPerCategory = 4,
  maxPerShop = 2,
): T[] {
  const kept = picks.filter((p) => !ownedIds.has(p.product_id));
  const targetSize = picks.length;
  if (kept.length === targetSize) return kept;

  const usedIds = new Set(kept.map((p) => p.product_id));
  const categoryCounts = new Map<string, number>();
  const shopCounts = new Map<string, number>();
  for (const p of kept) {
    categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
    shopCounts.set(p.shop_name, (shopCounts.get(p.shop_name) ?? 0) + 1);
  }

  const result = [...kept];
  for (const cand of pool) {
    if (result.length >= targetSize) break;
    if (usedIds.has(cand.product_id) || ownedIds.has(cand.product_id)) continue;
    const catCount = categoryCounts.get(cand.category) ?? 0;
    const shopCount = shopCounts.get(cand.shop_name) ?? 0;
    if (catCount >= maxPerCategory || shopCount >= maxPerShop) continue;
    result.push(cand);
    usedIds.add(cand.product_id);
    categoryCounts.set(cand.category, catCount + 1);
    shopCounts.set(cand.shop_name, shopCount + 1);
  }
  return result;
}
