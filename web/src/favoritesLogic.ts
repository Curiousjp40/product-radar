// Design review follow-up (Ryan): "Mis favoritos" -- brands and product
// types she likes, with a scoring boost so they rank higher in Hoy/Esta
// semana. Pure matching + boost math here (no i18n/DOM dependency, same
// convention as earningsGoalLogic.ts etc.), so it's directly unit
// testable and the boost amount is provably clamped/applied correctly.

export interface Favorites {
  categories: string[];
  brands: string[]; // shop_name values, exact match (case-insensitive)
  price_min: number | null;
  price_max: number | null;
}

export function emptyFavorites(): Favorites {
  return { categories: [], brands: [], price_min: null, price_max: null };
}

export function hasAnyFavorites(fav: Favorites): boolean {
  return fav.categories.length > 0 || fav.brands.length > 0;
}

/** True if the product matches a favorited category OR brand. Price
 * range (when set) narrows a brand/category match -- a favorited brand's
 * product outside her price range doesn't count as a favorite. */
export function matchesFavorites(product: { category: string; shop_name: string; price: number }, fav: Favorites): boolean {
  if (!hasAnyFavorites(fav)) return false;
  const inPriceRange = (fav.price_min === null || product.price >= fav.price_min) && (fav.price_max === null || product.price <= fav.price_max);
  if (!inPriceRange) return false;
  if (fav.categories.includes(product.category)) return true;
  return fav.brands.some((b) => b.toLowerCase() === product.shop_name.toLowerCase());
}

/** Boost added to a product's score when it matches favorites, clamped so
 * it can never flip a suspicious/filtered-out product into contention --
 * callers apply this AFTER the existing suspicious/quality filter, never
 * as a way around it. Default +0.15 per Ryan's example. */
export function applyFavoritesBoost(score: number, isFavorite: boolean, boost = 0.15): number {
  return isFavorite ? score + boost : score;
}
