/** Part 7 "En vivo" -- "Plan para tu proximo live" (2026-10-16): pure
 * selection logic for the 5-8 products to show on a live, prioritizing
 * products she already has (Mis Productos: Recibido/Grabado) over this
 * week's top fashion picks. Both input lists are expected pre-ordered by
 * priority within themselves (best first); this just concatenates with
 * ownedReady first, dedupes by product_id, and caps at maxProducts. */
export interface LivePlanProduct {
  product_id: string;
  name: string;
  earnings_per_sale: number;
  talking_point: string;
}

export function buildLivePlan(ownedReady: LivePlanProduct[], topPicks: LivePlanProduct[], maxProducts = 8): LivePlanProduct[] {
  const result: LivePlanProduct[] = [];
  const usedIds = new Set<string>();
  for (const p of [...ownedReady, ...topPicks]) {
    if (result.length >= maxProducts) break;
    if (usedIds.has(p.product_id)) continue;
    result.push(p);
    usedIds.add(p.product_id);
  }
  return result;
}
