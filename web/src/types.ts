export type Stage = "emerging" | "rising" | "peak" | "evergreen" | "declining" | "new_to_radar";
export type PickKind = "core" | "explore" | "evergreen" | "winner_again";

export interface VideoCard {
  video_id: string;
  cover_url: string;
  tiktok_url: string;
  creator_handle: string;
  play_count: number;
  window_gmv: number;
  window_units_sold: number;
  is_ad: boolean;
  duration_seconds: number | null;
}

export interface Pick {
  slot: number;
  kind: PickKind;
  product_id: string;
  title: string;
  clean_title: string;
  image_url: string;
  category: string;
  category_label_es: string;
  category_label_en: string;
  group: CategoryGroup;
  shop_name: string;
  price: number;
  commission_rate: number;
  earnings_per_sale: number;
  stage: Stage;
  score: number;
  ev_typical: number;
  ev_upside: number;
  units_7d: number;
  creator_count: number | null;
  daily_units_14: number[];
  season_event_label_es: string | null;
  season_event_label_en: string | null;
  reasons_es: string[];
  reasons_en: string[];
  summary_es: string;
  summary_en: string;
  videos: VideoCard[];
  fastmoss_url: string;
  tiktok_search_url: string;
  tiktok_shop_url: string;
  formula_ganadora: FormulaGanadora | null;
  saturation_badge: SaturationBadge | null;
  effort_minutes: number | null;
  spanish_share: number | null;
  pocas_creadoras_latinas: boolean;
  best_video_time: BestVideoTime | null;
}

export interface PicksFile {
  schema_version: number;
  week: string;
  creator: string;
  picks: Pick[];
}

export type CategoryGroup = "fashion" | "home";

export interface Candidate {
  product_id: string;
  title: string;
  clean_title: string;
  image_url: string;
  category: string;
  category_label_es: string;
  category_label_en: string;
  group: CategoryGroup;
  shop_name: string;
  // null for a suspicious/excluded candidate (see `suspicious` below) --
  // it never went through scoring, so there's no score/stage to show.
  stage: Stage | null;
  rank: number;
  price: number;
  commission_rate: number;
  earnings_per_sale: number;
  units_7d: number;
  units_total: number;
  score: number | null;
  ev_typical: number | null;
  daily_units: number[];
  is_pick: boolean;
  has_enrichment: boolean;
  suspicious: boolean;
  suspicious_reasons?: string[];
  rising_fast: boolean;
  season_event_label_es: string | null;
  season_event_label_en: string | null;
  fastmoss_url: string;
  tiktok_search_url: string;
  tiktok_shop_url: string;
  saturation_badge: SaturationBadge | null;
  effort_minutes: number | null;
  creator_count: number | null;
  spanish_share: number | null;
  pocas_creadoras_latinas: boolean;
}

export interface CandidatesFile {
  schema_version: number;
  week: string;
  candidates: Candidate[];
}

// Part E, added 2026-10-15 -- see engine/saturation.py for what this is
// actually derived from (no creator-count history exists to measure real
// creator growth, so it's a creators-per-100-units-sold-this-week ratio).
export interface SaturationBadge {
  level: "entra_ya" | "normal" | "muy_lleno";
  reason_es: string;
  reason_en: string;
}

export interface FormulaGanadora {
  top_hashtags: { hashtag: string; weight: number }[];
  ideal_duration: { seconds: number; source: "videos" } | { seconds: null; source: "creator_default"; sweet_spot_range: [number, number] };
  format_stats: { reply_pct: number; price_mention_pct: number; ad_pct: number };
  best_posting_hour: { hour_start: number; hour_end: number } | null;
  top_hooks: string[];
}

// Part C7a, added 2026-10-16: free best-time-to-post, computed from every
// video ever saved to data/snapshots/*/videos_*.json (see
// engine/posting_time.py). basis_level says which pool the window/weekdays
// came from -- "product" (this item's own videos), "category", "group", or
// "all" -- never blank, there's always some fallback level with a window.
export interface BestVideoTime {
  basis_level: "product" | "category" | "group" | "all";
  sample_size: number;
  used_organic_only: boolean;
  hour_start: number;
  hour_end: number;
  best_weekdays: number[]; // 0=Monday .. 6=Sunday, America/New_York
}

export interface ProductDetail {
  schema_version: number;
  product_id: string;
  title: string;
  clean_title: string;
  image_url: string;
  category: string;
  category_label_es: string;
  category_label_en: string;
  shop_name: string;
  price: number;
  commission_rate: number;
  earnings_per_sale: number;
  units_7d: number;
  units_total: number;
  creator_count: number | null;
  video_count: number | null;
  daily_units_14: number[];
  is_pick: boolean;
  fastmoss_url: string;
  tiktok_search_url: string;
  tiktok_shop_url: string;
  videos: VideoCard[];
  formula_ganadora: FormulaGanadora | null;
  saturation_badge: SaturationBadge | null;
  effort_minutes: number | null;
  spanish_share: number | null;
  pocas_creadoras_latinas: boolean;
  best_video_time: BestVideoTime | null;
}

// Part C7c, matches engine/export.py's write_best_times.
export interface CategoryGroupBestTime {
  sample_size: number;
  used_organic_only: boolean;
  hour_start: number;
  hour_end: number;
  best_weekdays: number[];
}

// Part C7b: same shape plus the typical length of a selling live.
export interface LiveBestTime extends CategoryGroupBestTime {
  median_duration_minutes: number | null;
}

export interface BestTimesFile {
  schema_version: number;
  categories: Record<string, CategoryGroupBestTime | null>;
  groups: Record<string, CategoryGroupBestTime | null>;
  live: Record<string, LiveBestTime | null>;
}

// Part 7 "En vivo" (2026-10-16): one real past live, for the "top-selling
// lives last 28 days" list -- engine.posting_time.top_lives_for_l1.
export interface LiveHighlight {
  room_id: string;
  title: string;
  creator_handle: string;
  started_at: string; // ISO, America/New_York
  duration_minutes: number;
  viewer_count: number;
  units_sold: number;
  gmv: number;
}

export interface LiveHighlightsFile {
  schema_version: number;
  categories: Record<string, LiveHighlight[]>;
}

// Part B Horarios rebuild (2026-10-16): one card per real group
// (moda/zapatos/muebles/hogar/mascotas -- engine.run.SCHEDULE_GROUPS),
// each with a day x 2-hour heat grid instead of a single best-window line.
export type ScheduleGroupKey = "moda" | "zapatos" | "muebles" | "hogar" | "mascotas";

export interface HeatGridCell {
  weekday: number;
  hour_start: number;
  hour_end: number;
  median_units: number;
  sample_size: number;
}

export interface LiveScheduleGroup {
  best: LiveBestTime | null;
  grid: HeatGridCell[];
  sample_size: number;
}

export interface LiveScheduleFile {
  schema_version: number;
  groups: Record<ScheduleGroupKey, LiveScheduleGroup>;
}

// "Lives que venden" paid investigation (2026-10-16, dry-run/fixture stage
// -- engine/live_products.py, engine.export.write_live_products). Keyed by
// room_id; a live with no entry here falls back to the plain
// LiveHighlight row (highlightRowHtml in views/enVivo.ts).
export interface LiveProductHost {
  handle: string;
  photo_url: string;
  follower_count: number;
  day28_gmv: number;
  top_category: string;
}

export interface LiveProductItem {
  product_id: string;
  title: string;
  image_url: string;
  price: number;
  commission_rate: number;
  units_sold: number;
}

export interface LiveProductCategoryBreakdown {
  category: string;
  units_sold_share_percent?: number;
}

export interface LiveProductSalesTimelinePoint {
  minute: number;
  units_sold: number;
  gmv: number;
}

export interface LiveProductDetail {
  room_id: string;
  host: LiveProductHost;
  started_at: string | null;
  duration_minutes: number | null;
  viewer_count: number;
  units_sold: number;
  gmv: number;
  conversion_rate: number | null;
  category_breakdown: LiveProductCategoryBreakdown[];
  sales_timeline: LiveProductSalesTimelinePoint[];
  products: LiveProductItem[];
}

export interface LiveProductsFile {
  schema_version: number;
  lives: Record<string, LiveProductDetail>;
}

export interface CreatorInsights {
  length_sweet_spot: Record<string, { video_count: number; gmv_per_video: number; units_per_10k_views: number }>;
  reach_vs_engagement: { views_gmv_corr: number | null; interaction_rate_gmv_corr: number | null };
  hit_tracker: { gmv_top1_share: number; gmv_top5_share: number; videos_per_week: number };
  format_tags: Record<string, { video_count: number; gmv_per_video: number; units_per_10k_views: number }>;
  summary: {
    video_count: number;
    gmv: number;
    units: number;
    views: number;
    median_views_per_video: number;
    median_gmv_per_video: number;
    avg_price_per_unit: number;
    units_per_10k_views: number;
    gmv_per_1k_views: number;
    gmv_top1_share: number;
    gmv_top5_share: number;
  };
}

export interface InsightsFile {
  schema_version: number;
  [creatorHandle: string]: CreatorInsights | number;
}

export interface SeasonEvent {
  id: string;
  label_es: string;
  label_en: string;
  categories: string[];
  film_start: string | null;
  film_end: string | null;
  notes_es?: string;
  notes_en?: string;
}

export interface SeasonsFile {
  schema_version: number;
  events: SeasonEvent[];
}

export interface MetaFile {
  schema_version: number;
  run_at: string;
  week: string;
  credits_used_this_run: number;
  credits_used_this_week: number;
  credits_used_month: number;
  credits_balance: number;
  weights_version: string;
  // Fixes the Mas credits widget showing "~2071 credits/week" (that was
  // total_consumed_credits / time-since-plan-start, not a per-run average).
  // Computed server-side from the local credit_ledger (engine.budget.
  // average_credits_per_run), since the Worker/frontend can't reach it.
  // null until there are 2+ qualifying weekly/midweek runs.
  avg_credits_per_run: number | null;
}

export type PipelineStatusName =
  | "shortlisted"
  | "sample_requested"
  | "sample_received"
  | "filmed"
  | "posted"
  | "skipped";

// "Buscar cuenta" (account search Worker), added 2026-10-15. The Worker's
// own response shape, mirroring worker/src/logic.js's map* functions.
export interface AccountSearchCreator {
  uid: string;
  unique_id: string;
  nickname: string;
  avatar: string;
  follower_count: number;
  video_count_total: number;
  day28_gmv: number;
  day28_units_sold: number;
  day28_video_count: number;
  total_gmv: number;
  video_avg_play_count: number;
  engagement_rate_percent: number;
  trend_categories: { id: number; name: string }[];
  age_distribution: { age_range: string; percentage: number }[];
  gender_distribution: { gender: string; percentage: number }[];
  // creator_fans_distribution (2cr, added 2026-10-15) -- the only source
  // for location, so worth its cost on top of the free audience_summary.
  country_distribution: { name: string; percentage: number }[];
  region_distribution: { name: string; percentage: number }[];
}

export interface AccountSearchVideo {
  video_id: string;
  caption_text: string;
  play_count: number;
  video_units_sold: number;
  video_gmv: number;
  tiktok_url: string | null;
}

export interface AccountSearchProduct {
  product_id: string;
  title: string;
  image_url: string | null;
  // number, a "$"-formatted string, or a "low-high" range string, depending
  // on which fallback field worker/src/logic.js's mapProductListResult
  // matched (creator_product_list's exact shape is still unconfirmed) --
  // web/src/views/buscarCuenta.ts's formatPrice handles all three.
  price: number | string;
  units_sold: number;
  gmv: number;
  commission_rate_percent: number;
}

export interface AccountSearchResult {
  creator: AccountSearchCreator;
  top_videos: AccountSearchVideo[];
  top_products: AccountSearchProduct[];
  fetched_at: string;
  from_cache?: boolean;
  not_found?: boolean;
  remaining_today?: number;
  remaining_month?: number;
  // A machine code (e.g. "daily_limit", "credit_floor"), never prose --
  // the Worker stays language-agnostic, web/src/views/buscarCuenta.ts maps
  // code + params to an i18n string in whichever language the page is in
  // (added 2026-10-15: the Worker previously hardcoded Spanish messages,
  // which broke EN mode). `detail` is raw/technical (e.g. a FastMoss error
  // string) and is never shown to the user, only useful for debugging.
  error?: string;
  params?: Record<string, number>;
  detail?: string;
}

// config/hooks.yaml exported as-is (Part C, added 2026-10-15) -- static
// template content, not per-week data.
export interface ComboPair {
  categories: [string, string];
  idea_es: string;
  idea_en: string;
}

export interface HooksFile {
  schema_version: number;
  hooks: Record<string, { es: string[]; en: string[] }>;
  shot_lists: Record<string, { es: string[]; en: string[] }>;
  category_to_shot_list: Record<string, string>;
  combo_pairs: ComboPair[];
  category_fit_keywords: Record<string, string[]>;
}
