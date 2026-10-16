// Part C "card redesign" (2026-10-16): pure metrics shared by every
// product card (Hoy, Esta semana, Todos) -- "is this worth my time?" at
// a glance. No imports, trivially unit-testable (same convention as
// earningsGoalLogic.ts).

export function salesPerCreator(units7d: number, creatorCount: number | null): number | null {
  if (!creatorCount || creatorCount <= 0) return null;
  return units7d / creatorCount;
}

/** ev_typical is a single point estimate; showing it as a single number
 * overstates how precise it is. +/-30% is a simple, honest spread --
 * never a claim the real number is pinned to a tighter band than the
 * score actually supports. */
export function monthlyEstimateRange(evTypical: number): { low: number; high: number } {
  return { low: Math.round(evTypical * 0.7), high: Math.round(evTypical * 1.3) };
}

export function salesToReachAmount(amount: number, earningsPerSale: number): number {
  if (earningsPerSale <= 0 || amount <= 0) return 0;
  return Math.ceil(amount / earningsPerSale);
}

export type TrendArrow = "up" | "down" | "flat";

/** % change vs the prior 7-day window inside a 14-day daily series,
 * mirroring engine.features.wow's own denominator floor (max(prior, 50))
 * so the frontend's "vs prior week" number doesn't wildly swing on tiny
 * bases while the backend's momentum score stays stable. */
export function weeklyUnitsChangePct(dailyUnits14: number[]): number | null {
  if (dailyUnits14.length < 14) return null;
  const prior7 = dailyUnits14.slice(0, 7).reduce((a, b) => a + b, 0);
  const last7 = dailyUnits14.slice(7, 14).reduce((a, b) => a + b, 0);
  return ((last7 - prior7) / Math.max(prior7, 50)) * 100;
}

export function trendArrow(pct: number | null, flatThresholdPct = 5): TrendArrow {
  if (pct === null) return "flat";
  if (pct > flatThresholdPct) return "up";
  if (pct < -flatThresholdPct) return "down";
  return "flat";
}

/** Compact SVG path for a tiny sparkline -- same shape product.ts's
 * sparklinePath already draws for the full sales-trend chart, just
 * exposed here so cards can reuse it at a small size. */
export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1 || 1);
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export type VerdictLabel = "vale_la_pena" | "tal_vez" | "pasalo";
export type VerdictReason = "paga_poco" | "mucha_demanda_pocas_creadoras" | "muy_lleno" | null;
export type SaturationLevel = "entra_ya" | "normal" | "muy_lleno" | null;

export interface VerdictThresholds {
  minScoreValeLaPena: number;
  minScoreTalVez: number;
  lowEarningsPerSale: number;
}

// "Config" per the request -- a plain exported object, not a JSON file,
// since the frontend has no shared config-loading mechanism; this is the
// single place these numbers live, same role config/weights.yaml plays
// for the backend's own thresholds.
export const DEFAULT_VERDICT_THRESHOLDS: VerdictThresholds = {
  minScoreValeLaPena: 55,
  minScoreTalVez: 30,
  lowEarningsPerSale: 2,
};

export interface Verdict {
  label: VerdictLabel;
  reason: VerdictReason;
}

/** "Vale la pena / Tal vez / Pasalo", from score + earnings + saturation,
 * priority order: too-saturated always loses regardless of score; low
 * pay always gets called out even on an otherwise decent score; low
 * creator competition with real demand ("entra ya") can lift a
 * middling score to a real recommendation; otherwise score alone decides. */
export function computeVerdict(
  score: number,
  earningsPerSale: number,
  saturationLevel: SaturationLevel,
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): Verdict {
  if (saturationLevel === "muy_lleno") {
    return { label: "pasalo", reason: "muy_lleno" };
  }
  if (earningsPerSale < thresholds.lowEarningsPerSale) {
    return { label: score >= thresholds.minScoreTalVez ? "tal_vez" : "pasalo", reason: "paga_poco" };
  }
  if (saturationLevel === "entra_ya" && score >= thresholds.minScoreTalVez) {
    return { label: "vale_la_pena", reason: "mucha_demanda_pocas_creadoras" };
  }
  if (score >= thresholds.minScoreValeLaPena) {
    return { label: "vale_la_pena", reason: null };
  }
  if (score < thresholds.minScoreTalVez) {
    return { label: "pasalo", reason: null };
  }
  return { label: "tal_vez", reason: null };
}
