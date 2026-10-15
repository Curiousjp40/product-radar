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
}

export interface Pick {
  slot: number;
  kind: PickKind;
  product_id: string;
  title: string;
  clean_title: string;
  image_url: string;
  category: string;
  shop_name: string;
  price: number;
  commission_rate: number;
  earnings_per_sale: number;
  stage: Stage;
  score: number;
  ev_typical: number;
  ev_upside: number;
  reasons_es: string[];
  reasons_en: string[];
  summary_es: string;
  summary_en: string;
  videos: VideoCard[];
  fastmoss_url: string;
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
  fastmoss_url: string;
  tiktok_search_url: string;
}

export interface CandidatesFile {
  schema_version: number;
  week: string;
  candidates: Candidate[];
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
  videos: VideoCard[];
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
  roxm___: CreatorInsights;
  ariannamendoza04: CreatorInsights;
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
