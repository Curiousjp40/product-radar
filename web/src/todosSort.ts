import type { Candidate } from "./types";

export type SortMode = "score" | "units" | "commission" | "earn" | "entra_ya";

// "Entra ya" sorts entra_ya-level candidates first, not a filter -- same as
// the other chips, it reorders the full list rather than hiding anything.
// "Pocas latinas" (Part H5) gets added here once that part's data exists.
export function sortCandidates(mode: SortMode, items: Candidate[]): Candidate[] {
  const arr = [...items];
  switch (mode) {
    case "units":
      return arr.sort((a, b) => b.units_7d - a.units_7d);
    case "commission":
      return arr.sort((a, b) => b.commission_rate - a.commission_rate);
    case "earn":
      return arr.sort((a, b) => b.earnings_per_sale - a.earnings_per_sale);
    case "entra_ya":
      return arr.sort((a, b) => {
        const aEntra = a.saturation_badge?.level === "entra_ya" ? 0 : 1;
        const bEntra = b.saturation_badge?.level === "entra_ya" ? 0 : 1;
        if (aEntra !== bEntra) return aEntra - bEntra;
        return (b.score ?? -1) - (a.score ?? -1);
      });
    default:
      return arr.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }
}
