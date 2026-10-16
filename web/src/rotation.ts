/** Part C's daily rotation (added 2026-10-15): which of this week's picks
 * to suggest filming today. Pure, deterministic given (pickIds, today,
 * excludeIds) -- the same creator sees the same N products all day, a
 * different N (when enough remain) tomorrow. This has to run client-side,
 * not at export time: the site is a static GitHub Pages build that only
 * rebuilds on a push, not daily, so "today" can only be known in the
 * browser at view time -- and "already posted" only exists in this
 * browser's own localStorage (engine/pipeline.ts has no visibility into
 * it). No frontend test runner exists yet in this project (web/ has none
 * of its own unit tests); kept deliberately small and easy to verify by
 * inspection instead of adding new tooling for one function. */

/** days-since-epoch, stable across a full calendar day regardless of time
 * zone drift within the same local day. */
function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

export function productsToFilmToday(pickIds: string[], today: Date, excludeIds: Set<string>, count = 6): string[] {
  const eligible = pickIds.filter((id) => !excludeIds.has(id));
  if (eligible.length === 0) return [];
  const offset = dayNumber(today) % eligible.length;
  const rotated = [...eligible.slice(offset), ...eligible.slice(0, offset)];
  return rotated.slice(0, count);
}
