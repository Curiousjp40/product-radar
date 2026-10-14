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

export interface Candidate {
  product_id: string;
  title: string;
  category: string;
  shop_name: string;
  stage: Stage;
  price: number;
  commission_rate: number;
  score: number;
  ev_typical: number;
  daily_units: number[];
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
  image_url: string;
  category: string;
  shop_name: string;
  price: number;
  commission_rate: number;
  earnings_per_sale: number;
  daily_units_14: number[];
  fastmoss_url: string;
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
