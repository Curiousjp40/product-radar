import type { Candidate } from "./types";

export type SortMode = "score" | "units" | "commission" | "earn" | "entra_ya" | "per_hour" | "pocas_latinas";

// Same formula as effortPay.ts's earningsPerHour, inlined rather than
// imported: this file stays a zero-runtime-import pure module (like
// rotation.ts/samplesLogic.ts) so it can be imported directly by
// web/test/*.test.ts under Node's native module resolution, which needs
// explicit file extensions on relative value imports that TS/Vite don't.
function perHour(earningsPerSale: number, effortMinutes: number | null): number {
  if (!effortMinutes || effortMinutes <= 0) return -1;
  return earningsPerSale / (effortMinutes / 60);
}

// "Entra ya" and "Pocas latinas" sort those candidates first, not a filter
// -- same as the other chips, they reorder the full list rather than
// hiding anything.
export function sortCandidates(mode: SortMode, items: Candidate[]): Candidate[] {
  const arr = [...items];
  switch (mode) {
    case "units":
      return arr.sort((a, b) => b.units_7d - a.units_7d);
    case "commission":
      return arr.sort((a, b) => b.commission_rate - a.commission_rate);
    case "earn":
      return arr.sort((a, b) => b.earnings_per_sale - a.earnings_per_sale);
    case "per_hour":
      return arr.sort(
        (a, b) => perHour(b.earnings_per_sale, b.effort_minutes) - perHour(a.earnings_per_sale, a.effort_minutes),
      );
    case "entra_ya":
      return arr.sort((a, b) => {
        const aEntra = a.saturation_badge?.level === "entra_ya" ? 0 : 1;
        const bEntra = b.saturation_badge?.level === "entra_ya" ? 0 : 1;
        if (aEntra !== bEntra) return aEntra - bEntra;
        return (b.score ?? -1) - (a.score ?? -1);
      });
    case "pocas_latinas":
      return arr.sort((a, b) => {
        const aGap = a.pocas_creadoras_latinas ? 0 : 1;
        const bGap = b.pocas_creadoras_latinas ? 0 : 1;
        if (aGap !== bGap) return aGap - bGap;
        return (b.score ?? -1) - (a.score ?? -1);
      });
    default:
      return arr.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }
}
