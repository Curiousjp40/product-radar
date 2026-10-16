/** Part 4 Solicitudes (2026-10-16): pure helpers split out of
 * misProductos.ts (which imports syncedStorage.ts, so it can't be
 * imported directly by the project's zero-import-friendly node test
 * runner -- same split as earningsGoal.ts/earningsGoalLogic.ts). */

interface MisProductoLike {
  status: string;
  date_requested: string;
  shop_name: string | null;
  times_rejected: number;
}

/** Whole days since a Pendiente was requested -- the amber "waiting 7+
 * days" flag threshold. */
export function daysWaiting(item: MisProductoLike, today: Date): number {
  return Math.floor((today.getTime() - new Date(item.date_requested).getTime()) / 86_400_000);
}

/** How many times `shopName` has ever rejected a request -- sums
 * `times_rejected` (not current status) across every item for that shop,
 * so a past rejection isn't forgotten once "Volver a pedir" resets a
 * request back to "solicitado". Shown before Roxie requests again from a
 * shop that has said no before. */
export function shopRejectionCount(items: MisProductoLike[], shopName: string): number {
  return items.filter((i) => i.shop_name === shopName).reduce((sum, i) => sum + i.times_rejected, 0);
}

/** Share of RESOLVED requests (shop actually responded) that were
 * approved rather than rejected -- still-waiting Pendientes don't count
 * either way. null with no resolved requests yet (nothing to divide by). */
export function approvalRate(items: MisProductoLike[]): number | null {
  const resolved = items.filter((i) => i.status !== "solicitado");
  if (resolved.length === 0) return null;
  const approved = resolved.filter((i) => i.status !== "rechazado").length;
  return approved / resolved.length;
}
