/** "Productos que mas se venden en lives" aggregation (density/redesign
 * pass, 2026-10-16): across all investigated lives, group by product_id
 * and sum units sold, count distinct lives, and track the best (lowest)
 * price it sold at -- lowest price is "best for her to also sell at"
 * since that's the price point that converted. Pure + unit tested. */
export interface LiveProductRef {
  product_id: string;
  title: string;
  image_url: string | null;
  price: number;
  units_sold: number;
}

export interface AggregatedLiveProduct {
  product_id: string;
  title: string;
  image_url: string | null;
  total_units_sold: number;
  live_count: number;
  best_price: number;
}

export function aggregateTopLiveProducts(
  livesProducts: LiveProductRef[][],
  limit = 12,
): AggregatedLiveProduct[] {
  const byId = new Map<string, AggregatedLiveProduct>();
  for (const products of livesProducts) {
    for (const p of products) {
      const existing = byId.get(p.product_id);
      if (!existing) {
        byId.set(p.product_id, {
          product_id: p.product_id,
          title: p.title,
          image_url: p.image_url,
          total_units_sold: p.units_sold,
          live_count: 1,
          best_price: p.price,
        });
      } else {
        existing.total_units_sold += p.units_sold;
        existing.live_count += 1;
        if (p.price > 0 && (existing.best_price <= 0 || p.price < existing.best_price)) {
          existing.best_price = p.price;
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.total_units_sold - a.total_units_sold).slice(0, limit);
}
