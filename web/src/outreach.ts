// H4 (brand outreach), part of the 2026-10-15 creator-workflow upgrade.
// Built entirely from this week's own candidates.json (shop_name,
// commission_rate, creator_count) -- nothing new fetched.
export interface OutreachCandidate {
  product_id: string;
  shop_name: string;
  clean_title: string;
  commission_rate: number;
  creator_count: number | null;
  earnings_per_sale: number;
  fastmoss_url: string;
  has_enrichment: boolean;
}

export interface OutreachShop<T extends OutreachCandidate> {
  shop_name: string;
  avg_commission_rate: number;
  avg_creator_count: number;
  representative_product: T;
}

function quantile(sortedAscending: number[], q: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.max(0, Math.round(q * (sortedAscending.length - 1))));
  return sortedAscending[idx];
}

// Percentile-based, not an absolute cutoff: commission rates and
// creator_count both vary wildly week to week and category to category, so
// "qualifies if above a fixed 20%" can match nothing some weeks and
// everything others. Instead this finds shops that are simultaneously in
// this week's own top commissionTopFraction (by avg commission) and bottom
// creatorCountBottomFraction (by avg creator_count) -- self-calibrating to
// whatever this week's candidates actually look like.
export function outreachShops<T extends OutreachCandidate>(
  candidates: T[],
  commissionTopFraction = 0.5,
  creatorCountBottomFraction = 0.5,
  minCandidatesForShopAvg = 1,
): OutreachShop<T>[] {
  const byShop = new Map<string, T[]>();
  for (const c of candidates) {
    if (!c.has_enrichment || c.creator_count === null) continue;
    const list = byShop.get(c.shop_name) ?? [];
    list.push(c);
    byShop.set(c.shop_name, list);
  }

  const shopStats = [...byShop.entries()]
    .filter(([, items]) => items.length >= minCandidatesForShopAvg)
    .map(([shopName, items]) => ({
      shopName,
      items,
      avgCommission: items.reduce((sum, c) => sum + c.commission_rate, 0) / items.length,
      avgCreatorCount: items.reduce((sum, c) => sum + (c.creator_count ?? 0), 0) / items.length,
    }));
  if (shopStats.length === 0) return [];

  const commissionThreshold = quantile(
    shopStats.map((s) => s.avgCommission).sort((a, b) => a - b),
    1 - commissionTopFraction,
  );
  const creatorCountThreshold = quantile(
    shopStats.map((s) => s.avgCreatorCount).sort((a, b) => a - b),
    creatorCountBottomFraction,
  );

  return shopStats
    .filter((s) => s.avgCommission >= commissionThreshold && s.avgCreatorCount <= creatorCountThreshold)
    .map((s) => ({
      shop_name: s.shopName,
      avg_commission_rate: s.avgCommission,
      avg_creator_count: s.avgCreatorCount,
      representative_product: s.items.reduce((best, c) => (c.earnings_per_sale > best.earnings_per_sale ? c : best)),
    }))
    .sort((a, b) => b.avg_commission_rate - a.avg_commission_rate);
}

// "link to shop's FastMoss page" (H4's spec) -- there's no confirmed
// FastMoss shop-detail URL pattern anywhere in docs/fastmoss_tools.json or
// field_map.md (only the product-detail URL template is confirmed), and
// CLAUDE.md says never guess a FastMoss URL, so this links to the
// representative product's own (confirmed) FastMoss page instead.
export function outreachMessage(shopName: string, productTitle: string, commissionPct: number, lang: "es" | "en"): string {
  if (lang === "es") {
    return `¡Hola! Me encantó "${productTitle}" de ${shopName} y la comisión de ${commissionPct}%. Soy creadora de contenido en TikTok Shop y me gustaría hacer un video mostrándolo -- ¿podemos coordinar una muestra?\n\nRoxie, @roxm___`;
  }
  return `Hi! I loved "${productTitle}" from ${shopName} and the ${commissionPct}% commission. I'm a TikTok Shop content creator and would love to make a video featuring it -- could we coordinate a sample?\n\nRoxie, @roxm___`;
}
