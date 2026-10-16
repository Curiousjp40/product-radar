import type { Candidate, Pick } from "./types";

/** Part 3 "Ya lo tengo" swap (2026-10-16): Hoy/Esta semana's rich card
 * needs a full `Pick`, but the backfill pool (candidates.json) only has
 * the lighter `Candidate` shape -- no video/hashtag/formula enrichment,
 * since that's only fetched for the official weekly picks. Stubs those
 * fields empty/null rather than guessing; the existing card templates
 * already render those sections conditionally (hidden when empty), so a
 * backfilled card just shows less, same as any pick with no video data. */
export function candidateToPickStub(c: Candidate): Pick {
  return {
    slot: 0,
    kind: "core",
    product_id: c.product_id,
    title: c.title,
    clean_title: c.clean_title,
    image_url: c.image_url,
    category: c.category,
    category_label_es: c.category_label_es,
    category_label_en: c.category_label_en,
    group: c.group,
    shop_name: c.shop_name,
    price: c.price,
    commission_rate: c.commission_rate,
    earnings_per_sale: c.earnings_per_sale,
    stage: c.stage ?? "emerging",
    score: c.score ?? 0,
    ev_typical: c.ev_typical ?? 0,
    ev_upside: c.ev_typical ?? 0,
    units_7d: c.units_7d,
    creator_count: c.creator_count,
    daily_units_14: c.daily_units,
    season_event_label_es: c.season_event_label_es,
    season_event_label_en: c.season_event_label_en,
    reasons_es: [],
    reasons_en: [],
    summary_es: "",
    summary_en: "",
    videos: [],
    fastmoss_url: c.fastmoss_url,
    tiktok_search_url: c.tiktok_search_url,
    tiktok_shop_url: c.tiktok_shop_url,
    formula_ganadora: null,
    saturation_badge: c.saturation_badge,
    effort_minutes: c.effort_minutes,
    spanish_share: c.spanish_share,
    pocas_creadoras_latinas: c.pocas_creadoras_latinas,
    best_video_time: null,
  };
}
