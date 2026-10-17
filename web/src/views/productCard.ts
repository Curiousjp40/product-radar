import {
  computeVerdict,
  monthlyEstimateRange,
  salesPerCreator,
  salesToReachAmount,
  sparklinePath,
  trendArrow,
  weeklyUnitsChangePct,
  type SaturationLevel,
} from "../cardMetrics";
import { t, type Lang } from "../i18n";
import type { SaturationBadge } from "../types";

/** Part C "card redesign" (2026-10-16): the shared "is this worth my
 * time?" info block for every product card (Hoy, Esta semana, Todos).
 * `Pick` and `Candidate` differ slightly (daily_units_14 vs daily_units,
 * score always set vs nullable) -- this input shape is the overlap both
 * can provide. */
export interface ProductCardInput {
  earnings_per_sale: number;
  price: number;
  commission_rate: number;
  units_7d: number;
  daily_units_14: number[];
  creator_count: number | null;
  ev_typical: number | null;
  score: number | null;
  saturation_badge: SaturationBadge | null;
}

export interface ProductCardOptions {
  lang: Lang;
  monthlyGoalRemaining?: number | null;
  isOwned?: boolean;
  risingFast?: boolean;
  pocasLatinas?: boolean;
  seasonEventLabel?: string | null;
  /** Design review 2/3.2: compact cards show only 3 short lines (earn,
   * units + trend, verdict) and at most 2 tags -- everything else
   * (per-creator sales, monthly estimate, sales-to-goal) moves to the
   * detail sheet. Default false keeps the full info block. */
  compact?: boolean;
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function verdictLabelKey(label: string): string {
  return `verdict_${label}`;
}

function verdictReasonKey(reason: string): string {
  return `verdict_reason_${reason}`;
}

/** The 1-6 info block, in spec order, plus tags (only when true). Keep
 * this the ONE place every card's "worth my time" numbers are computed
 * and rendered, so Hoy/Esta semana/Todos never drift from each other. */
export function productCardInfoHtml(data: ProductCardInput, opts: ProductCardOptions): string {
  const { lang } = opts;

  // 1. Earnings headline + price/commission.
  const earnLine = `
    <div class="card-v2-earn">${t("earn_headline", lang, { amount: data.earnings_per_sale.toFixed(2) })}</div>
    <div class="card-v2-price-commission">${formatMoney(data.price)} &middot; ${(data.commission_rate * 100).toFixed(0)}% ${t("commission", lang)}</div>
  `;

  // 2. Units sold + % vs prior week + sparkline + arrow.
  const pct = weeklyUnitsChangePct(data.daily_units_14);
  const arrow = trendArrow(pct);
  const arrowGlyph = arrow === "up" ? "▲" : arrow === "down" ? "▼" : "→";
  const path = data.daily_units_14.length === 14 ? sparklinePath(data.daily_units_14, 48, 16) : "";
  const unitsLine = `
    <div class="card-v2-units">
      <span>${data.units_7d} ${t("units_sold_short", lang)}</span>
      ${pct !== null ? `<span class="card-v2-trend-${arrow}">${arrowGlyph} ${Math.min(Math.abs(pct), 999).toFixed(0)}%${Math.abs(pct) > 999 ? "+" : ""}</span>` : ""}
      ${path ? `<svg class="card-v2-sparkline" viewBox="0 0 48 16" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>` : ""}
    </div>
  `;

  // 3. Sales per creator (hidden when creator_count is unknown).
  const perCreator = salesPerCreator(data.units_7d, data.creator_count);
  const perCreatorLine = perCreator !== null ? `<div class="card-v2-line">${t("sales_per_creator", lang, { n: perCreator.toFixed(1) })}</div>` : "";

  // 4. Monthly estimate range.
  const estimateLine =
    data.ev_typical !== null
      ? (() => {
          const { low, high } = monthlyEstimateRange(data.ev_typical as number);
          return `<div class="card-v2-line">${t("monthly_estimate_label", lang, { low: formatMoney(low), high: formatMoney(high) })}</div>`;
        })()
      : "";

  // 5. "N sales = $100" or "N sales = your goal".
  const salesToGoalLine = (() => {
    if (opts.monthlyGoalRemaining && opts.monthlyGoalRemaining > 0) {
      const n = salesToReachAmount(opts.monthlyGoalRemaining, data.earnings_per_sale);
      return n > 0 ? `<div class="card-v2-line">${t("sales_equal_your_goal", lang, { n })}</div>` : "";
    }
    const n = salesToReachAmount(100, data.earnings_per_sale);
    return n > 0 ? `<div class="card-v2-line">${t("sales_equal_100", lang, { n })}</div>` : "";
  })();

  // 6. Verdict chip.
  const saturationLevel: SaturationLevel = data.saturation_badge?.level ?? null;
  const verdict = data.score !== null ? computeVerdict(data.score, data.earnings_per_sale, saturationLevel) : null;
  const verdictHtml = verdict
    ? `
      <div class="card-v2-verdict verdict-${verdict.label}">
        <span class="verdict-chip">${t(verdictLabelKey(verdict.label), lang)}</span>
        ${verdict.reason ? `<span class="verdict-reason">${t(verdictReasonKey(verdict.reason), lang)}</span>` : ""}
      </div>
    `
    : "";

  // Tags -- only when true. Owned beats the others in compact mode (max 2
  // tags there): it's the single most actionable fact about the card.
  const tags: string[] = [];
  if (opts.isOwned) tags.push(`<span class="saturation-badge owned-badge">${t("ya_lo_tienes_tag", lang)}</span>`);
  if (opts.risingFast) tags.push(`<span class="saturation-badge rising-fast-badge">${t("rising_fast_tag", lang)}</span>`);
  if (opts.pocasLatinas) tags.push(`<span class="saturation-badge pocas-latinas-badge">${t("pocas_latinas_tag", lang)}</span>`);
  if (opts.seasonEventLabel) tags.push(`<span class="saturation-badge season-event-badge">${opts.seasonEventLabel}</span>`);
  const visibleTags = opts.compact ? tags.slice(0, 2) : tags;
  const tagsHtml = visibleTags.length > 0 ? `<div class="card-v2-tags">${visibleTags.join("")}</div>` : "";

  if (opts.compact) {
    return `
      <div class="card-v2-info card-v2-info-compact">
        ${earnLine}
        ${unitsLine}
        ${verdictHtml}
        ${tagsHtml}
      </div>
    `;
  }

  return `
    <div class="card-v2-info">
      ${earnLine}
      ${unitsLine}
      ${perCreatorLine}
      ${estimateLine}
      ${salesToGoalLine}
      ${verdictHtml}
      ${tagsHtml}
    </div>
  `;
}
