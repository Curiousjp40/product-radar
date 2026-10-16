/** Part A.3 (2026-10-16): in a browsing list (Todos, "Everything else
 * this week"), an owned product is never removed from the pool the way
 * Hoy/Esta semana's curated picks are (ownedSwap.ts) -- it's tagged "Ya
 * lo tienes" and either hidden (default) or pushed to the bottom of its
 * section, so the list stays a full catalog, just deprioritized by what
 * she already has. */
export function applyOwnedDisplay<T>(items: T[], ownedIds: Set<string>, getId: (item: T) => string, hideOwned: boolean): T[] {
  const notOwned = items.filter((i) => !ownedIds.has(getId(i)));
  if (hideOwned) return notOwned;
  const owned = items.filter((i) => ownedIds.has(getId(i)));
  return [...notOwned, ...owned];
}
