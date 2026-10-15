"""CLI entry: python -m engine.run [--dry-run] [--week 2026-W43] [--print-picks] [--budget N]

Wires engine/{client,ingest,normalize,config,features,stages,fit,seasonality,
language,scoring,picks,export,budget,db}.py together -- every algorithm stays
a pure function in its own module (instruction 0.6); this file is "the
pipeline" that wires them together with real (or dry-run fixture) data.
"""

from __future__ import annotations

import argparse
import asyncio
import math
import urllib.parse
import uuid
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv

from engine import export
from engine.budget import (
    BudgetExceeded,
    BudgetTracker,
    append_credit_log,
    check_balance,
    credits_used_for_week,
    write_ledger_row,
)
from engine.client import FastMossClient, FastMossError, FixtureReplayClient
from engine.config import load_all
from engine.db import connect
from engine.features import acceleration, demand, momentum, momentum_multiplier, slope_log1p, wow
from engine.fit import (
    audience_fit,
    blended_price_fit,
    category_prior_raw,
    creator_avg_category_gpm,
    demographic_fit_heuristic,
    fit_score,
    normalize_priors,
    price_sweet_spot_for_category,
    target_category_boost,
)
from engine.images import cache_image
from engine.ingest import (
    fetch_daily_trend,
    fetch_product_videos,
    fetch_top_selling,
    load_raw_snapshot,
    resolve_category_ids,
    save_raw_snapshot,
)
from engine.insights import summarize_creator
from engine.language import spanish_share
from engine.normalize import (
    normalize_rank_row,
    trend_period_summary,
    video_cards_from_product_video_list,
)
from engine.picks import (
    build_top10,
    candidate_event_ids,
    compute_blended_ranks,
    enforce_group_minimums,
    filter_diverse_topn,
    is_near_duplicate,
    pick_explore_categories,
    render_reason,
    select_top_reasons,
    thompson_sample_categories,
)
from engine.quality import shop_round_price_cluster_ids, suspicious_reasons
from engine.scoring import (
    composite_score,
    earnings_per_sale,
    expected_value,
    log_earnings,
    opportunity,
    risk_penalty,
    saturation_multiplier,
    spanish_gap,
)
from engine.seasonality import (
    boosted_category_multiplier,
    event_term,
    personal_term,
    season_ending_factor,
    seasonality_score,
    title_matches_event_keywords,
)
from engine.seed import load_creator_history, shop_videos_only
from engine.stages import classify_stage
from engine.stats import grouped_robust_z
from engine.text import clean_title, days_remaining_phrase, extract_brand, join_reasons_as_sentence
from engine.timeutil import now_eastern

REPO_ROOT = Path(__file__).resolve().parent.parent
CREATOR = "roxm___"
# Confirmed 2026-10-15 via the free fastmoss_detail_url_examples tool (0
# credits) -- "Replace the placeholder in template with the corresponding
# ID returned by FastMoss MCP tools."
FASTMOSS_PRODUCT_URL_TEMPLATE = "https://www.fastmoss.com/e-commerce/detail/{product_id}"
# Free (no FastMoss credits) buttons on every product, full list included --
# added 2026-10-18 per explicit instruction, not a guess: a TikTok SEARCH
# link (there's no confirmed way to build a direct TikTok Shop product URL
# from a FastMoss product_id -- see docs/field_map.md).
TIKTOK_SEARCH_URL_TEMPLATE = "https://www.tiktok.com/search?q={query}"


def tiktok_search_url(clean_product_title: str) -> str:
    return TIKTOK_SEARCH_URL_TEMPLATE.format(query=urllib.parse.quote(clean_product_title))

# Dry-run only has Phase 0's real fixtures for one category (shapewear) -- it
# proves the pipeline wiring works end to end on real-shaped data at zero
# credits, not a realistic multi-category simulation. The real run spans
# whichever categories.yaml categories are active() for `today` (below).
DRY_RUN_CATEGORY_KEYS = ["shapewear"]
# SHORTLIST_SIZE candidates (by preliminary score, before trend/video
# enrichment) get the expensive per-product calls. A full real run (12
# categories: 5 core x 3 pages + 4 secondary x 2 pages + up to 2 seasonal x 2
# pages in-window = 23-27 credits for the full list) + 15 x (trend + video)
# = 53-57 credits, comfortably under the ~70 target and the 90-credit hard
# cap (config/weights.yaml), restructured 2026-10-18 for Roxie's 12-category
# home+fashion target list.
SHORTLIST_SIZE = 15


def active_categories(categories_cfg: dict, today: date) -> dict[str, dict]:
    """Which config/categories.yaml categories to scan THIS run: every
    "core"/"secondary" tier category, plus any "seasonal" one whose
    [scan_start, scan_end] window includes `today` (e.g. costumes only
    until Halloween). Distinct from config/seasons.yaml's event calendar,
    which scores a boost and doesn't control what gets fetched at all."""
    active: dict[str, dict] = {}
    for key, meta in categories_cfg.items():
        tier = meta.get("tier")
        if tier in ("core", "secondary"):
            active[key] = meta
        elif tier == "seasonal":
            scan_start = date.fromisoformat(meta["scan_start"]) if meta.get("scan_start") else date.min
            scan_end = date.fromisoformat(meta["scan_end"]) if meta.get("scan_end") else date.max
            if scan_start <= today <= scan_end:
                active[key] = meta
    return active

DRY_RUN_FIXTURES = {
    "credit_usage_summary": "fastmoss_credit_usage_summary.json",
    "search_category_by_words": "fastmoss_search_category_by_words.json",
    "product_rank_top_selling": "fastmoss_product_rank_top_selling.json",
    "product_sales_trend": "fastmoss_product_sales_trend.json",
    "product_overview": "fastmoss_product_overview.json",
    "product_video_list": "fastmoss_product_video_list.json",
}


def iso_week_label(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def last_completed_week_value(today: date) -> str:
    last_week = today - timedelta(days=7)
    y, w, _ = last_week.isocalendar()
    return f"{y}-W{w:02d}"


# ---------------------------------------------------------------------------
# Ingestion: real FastMoss calls (or fixture replay), budget-checkpointed
# ---------------------------------------------------------------------------


async def ingest(
    client, config: dict, week: str, date_value: str, today: date, tracker: BudgetTracker, is_dry_run: bool
) -> list[dict]:
    if is_dry_run:
        category_meta = {k: config["categories"]["categories"][k] for k in DRY_RUN_CATEGORY_KEYS}
    else:
        category_meta = active_categories(config["categories"]["categories"], today)

    pinned = {key: meta["fastmoss_category_id"] for key, meta in category_meta.items() if "fastmoss_category_id" in meta}
    # Only live-resolve a category without a confirmed pinned ID -- every
    # real category is pinned as of 2026-10-18's rework, so this is now a
    # dormant fallback, not the normal path. Live fuzzy search proved
    # unreliable for ambiguous terms (see categories.yaml's comments:
    # "shapewear"/"women's clothing" alone resolved to bras and Halloween
    # costumes respectively in testing). Free (0 credits) either way.
    unpinned = {k: meta["label_en"] for k, meta in category_meta.items() if k not in pinned}
    resolved = await resolve_category_ids(client, unpinned) if unpinned else {}
    category_ids = {**pinned, **{
        k: (cat.get("category_id_level2") or cat.get("category_id_level3") or cat.get("category_id_level1"))
        for k, cat in resolved.items()
    }}
    balance = await check_balance(client)
    tracker.checkpoint("category_resolution", balance)

    def maybe_save_snapshot(name: str, payload: dict) -> str | None:
        # Dry-run replays the same fixture for every call -- saving it as a
        # "snapshot" would just be redundant copies of tests/fixtures/ content.
        return None if is_dry_run else save_raw_snapshot(week, name, payload)

    # Full list (changed 2026-10-18): top 30/20 by UNITS SOLD per category
    # (3 or 2 paged calls x 10/page per categories.yaml's `pages`, 1 credit
    # each -- pagesize is capped at 10 by the tool) instead of a single page
    # trimmed to the top 3 by GMV. The suspicious-listing filter runs on
    # this whole list (see partition_suspicious in run()), and it's also the
    # "Todos" page's full data, not just a scoring input -- both need real
    # category-wide coverage, not a sliver.
    candidates: list[dict] = []
    for key, category_id in category_ids.items():
        pages = 1 if is_dry_run else category_meta[key]["pages"]
        for page in range(1, pages + 1):
            raw = await fetch_top_selling(client, category_id, week=week, date_value=date_value, page=page)
            raw_ref = maybe_save_snapshot(f"top_selling_{key}_p{page}", raw)
            for i, row in enumerate(raw.get("list", []), start=(page - 1) * 10 + 1):
                product, snapshot = normalize_rank_row(row, week=week, rank=i, raw_ref=raw_ref)
                candidates.append(
                    {
                        "product_id": product.product_id,
                        "config_category": key,
                        "category_l1": product.category_l1,
                        "category_l2": product.category_l2,
                        "category_l3": row.get("category", {}).get("l3", {}).get("name"),
                        "title": product.title,
                        "image_url": product.image_url,
                        "shop_id": product.shop_id,
                        "shop_name": product.shop_name,
                        "price": snapshot.price,
                        "commission_rate": snapshot.commission_rate,
                        "units_7d": snapshot.units_7d or 0,
                        "gmv_7d": snapshot.gmv_7d or 0.0,
                        "units_total": snapshot.units_total or 0,
                        "growth_rate": snapshot.growth_rate or 0.0,
                        "rank": snapshot.rank,
                        "delisted": product.delisted,
                        "creator_count": None,
                        "video_count": None,
                        "ads_share_pct": None,
                        "channel_breakdown": None,
                        "spanish_share": None,
                        "videos": None,
                    }
                )
            balance = await check_balance(client)
            tracker.checkpoint("rankings", balance, note=f"category {key} page {page}/{pages}")
    candidates = [c for c in candidates if not c["delisted"]]
    return candidates


def ingest_from_snapshots(week: str, category_keys: list[str]) -> list[dict]:
    """Rebuilds the candidate pool from data/snapshots/<week>/ instead of
    calling FastMoss again -- zero credits. Used by --resume-week to recover
    from a crash after a real (paid) ingest already ran; also handy for
    replaying a past week's real data through a fixed/changed scoring
    pipeline without re-spending credits on ingestion."""
    max_pages = 3  # core tier's page count (config/categories.yaml) -- the highest any category uses
    candidates: list[dict] = []
    for key in category_keys:
        for page in range(1, max_pages + 1):
            raw = load_raw_snapshot(week, f"top_selling_{key}_p{page}")
            if raw is None:
                break  # pages are saved in order -- a gap means we never fetched further (or this category uses fewer)
            raw_ref = f"data/snapshots/{week}/top_selling_{key}_p{page}.json"
            for i, row in enumerate(raw.get("list", []), start=(page - 1) * 10 + 1):
                product, snapshot = normalize_rank_row(row, week=week, rank=i, raw_ref=raw_ref)
                candidates.append(
                    {
                        "product_id": product.product_id,
                        "config_category": key,
                        "category_l1": product.category_l1,
                        "category_l2": product.category_l2,
                        "category_l3": row.get("category", {}).get("l3", {}).get("name"),
                        "title": product.title,
                        "image_url": product.image_url,
                        "shop_id": product.shop_id,
                        "shop_name": product.shop_name,
                        "price": snapshot.price,
                        "commission_rate": snapshot.commission_rate,
                        "units_7d": snapshot.units_7d or 0,
                        "gmv_7d": snapshot.gmv_7d or 0.0,
                        "units_total": snapshot.units_total or 0,
                        "growth_rate": snapshot.growth_rate or 0.0,
                        "rank": snapshot.rank,
                        "delisted": product.delisted,
                        "creator_count": None,
                        "video_count": None,
                        "ads_share_pct": None,
                        "channel_breakdown": None,
                        "spanish_share": None,
                        "videos": None,
                    }
                )
    candidates = [c for c in candidates if not c["delisted"]]

    for cand in candidates:
        trend_raw = load_raw_snapshot(week, f"trend_{cand['product_id']}")
        if trend_raw is not None:
            days = trend_raw.get("daily_trend", [])
            cand["daily_units_14"] = [d["daily_units_sold"] for d in days[-14:]] if len(days) >= 14 else None
            summary = trend_period_summary(trend_raw)
            cand["creator_count"] = summary.get("linked_creator_count")
            cand["video_count"] = summary.get("linked_video_count")

        # 2026-10-15/16: reuse a previously-saved videos_<id>.json snapshot
        # (written by enrich_shortlist on an earlier real run) so a pure
        # re-score from snapshots doesn't need to re-fetch -- see
        # enrich_shortlist's cache check below, which skips any candidate
        # that already has `videos` set here. Sourced from product_video_list
        # (filtered by product_id), not video_search's free-text keyword
        # match, which returned videos unrelated to the product.
        videos_raw = load_raw_snapshot(week, f"videos_{cand['product_id']}")
        if videos_raw is not None:
            cards = video_cards_from_product_video_list(videos_raw)
            cand["videos"] = cards
            captions = [v["caption_text"] for v in cards]
            cand["spanish_share"] = spanish_share(captions)
            cand["spanish_video_count"] = len(captions)

    return candidates


async def enrich_shortlist(client, shortlist: list[dict], week: str, tracker: BudgetTracker) -> None:
    """Trend (14-day chart + creator/video counts, section 6.2/6.3/6.5) and
    video cards + Spanish-gap signal (section 6.8), for the preliminary top
    `SHORTLIST_SIZE` candidates by score only (budget) -- renamed from
    enrich_spanish_gap 2026-10-18 when trend-fetching moved here too (it used
    to run on a separate "top 3 per category" pool inside ingest(), which no
    longer exists now that the full list isn't trimmed before scoring).
    Skips any candidate that already has this data set (resume-from-
    snapshots reuse)."""
    fetched = 0
    for cand in shortlist:
        if tracker.would_exceed(2):
            break
        if cand.get("daily_units_14") is None:
            try:
                trend_raw = await fetch_daily_trend(client, cand["product_id"])
                save_raw_snapshot(week, f"trend_{cand['product_id']}", trend_raw)
                days = trend_raw.get("daily_trend", [])
                cand["daily_units_14"] = [d["daily_units_sold"] for d in days[-14:]] if len(days) >= 14 else None
                summary = trend_period_summary(trend_raw)
                cand["creator_count"] = summary.get("linked_creator_count")
                cand["video_count"] = summary.get("linked_video_count")
            except FastMossError:
                pass
            balance = await check_balance(client)
            tracker.checkpoint("trend", balance, note=f"product {fetched + 1}/{len(shortlist)}")

        if cand.get("videos") is not None:
            fetched += 1
            continue
        try:
            raw = await fetch_product_videos(client, cand["product_id"])
            save_raw_snapshot(week, f"videos_{cand['product_id']}", raw)
            cards = video_cards_from_product_video_list(raw)
            cand["videos"] = cards
            captions = [v["caption_text"] for v in cards]
            cand["spanish_share"] = spanish_share(captions)
            cand["spanish_video_count"] = len(captions)
        except FastMossError:
            pass
        fetched += 1
        balance = await check_balance(client)
        tracker.checkpoint("videos", balance, note=f"candidate {fetched}/{len(shortlist)}")


def partition_suspicious(candidates: list[dict], weights: dict) -> tuple[list[dict], list[dict]]:
    """Splits candidates into (clean, flagged) using engine/quality.py's
    rules, added 2026-10-15 after a real run surfaced a same-shop,
    same-round-price, boilerplate-title cluster that nothing else in the
    pipeline would catch. Flagged candidates are excluded from scoring/picks
    but kept (with their reasons) for export, so they're visible, not just
    silently dropped."""
    q = weights.get("quality", {})
    price_mult = q.get("price_outlier_multiplier", 4.0)
    round_divisor = q.get("round_price_divisor", 50)
    min_cluster = q.get("round_price_min_cluster", 2)
    gmv_threshold = q.get("low_density_gmv_threshold", 20_000)
    min_creators = q.get("low_density_min_creators", 5)
    affiliate_threshold = q.get("low_affiliate_share_threshold_pct", 20)

    # Category median price, grouped by L3 where the group is big enough to
    # be meaningful (>= 3), else falling back to the broader config_category
    # group -- most L3 subcategories only have 1-2 candidates in a 10-item
    # ranking, too sparse for "the median of this L3" to mean anything.
    by_l3: dict[str, list[float]] = {}
    by_config_cat: dict[str, list[float]] = {}
    for c in candidates:
        by_l3.setdefault(c.get("category_l3") or "", []).append(c["price"])
        by_config_cat.setdefault(c["config_category"], []).append(c["price"])

    def category_median_price(c: dict) -> float:
        l3_prices = by_l3.get(c.get("category_l3") or "", [])
        prices = l3_prices if len(l3_prices) >= 3 else by_config_cat.get(c["config_category"], [])
        return float(pd.Series(prices).median()) if prices else 0.0

    cluster_ids = shop_round_price_cluster_ids(candidates, round_divisor, min_cluster)

    clean, flagged = [], []
    for c in candidates:
        reasons = suspicious_reasons(
            c,
            category_median_price=category_median_price(c),
            shop_price_cluster_ids=cluster_ids,
            price_outlier_multiplier=price_mult,
            low_density_gmv_threshold=gmv_threshold,
            low_density_min_creators=min_creators,
            low_affiliate_share_threshold_pct=affiliate_threshold,
        )
        if reasons:
            flagged.append({**c, "suspicious_reasons": reasons})
        else:
            clean.append(c)
    return clean, flagged


# ---------------------------------------------------------------------------
# Scoring: pure-function wiring over the pooled candidates
# ---------------------------------------------------------------------------


def _creator_stats(config: dict) -> dict:
    seed_path = REPO_ROOT / "data" / "seed" / "creator_history.json"
    videos = load_creator_history(seed_path)
    roxie = shop_videos_only([v for v in videos if v.creator == CREATOR])
    views = np.array([v.views for v in roxie], dtype=float)
    summary = summarize_creator(roxie)
    by_month_category: dict[int, dict[str, float]] = {}
    for v in roxie:
        month = v.published_at.month
        by_month_category.setdefault(month, {})
        by_month_category[month][v.category or "other"] = by_month_category[month].get(v.category or "other", 0.0) + v.gmv
    return {
        "n_tracked_videos": len(roxie),
        "median_views": float(np.median(views)),
        # p75, not p90 (changed 2026-10-15 per explicit instruction) -- "si le
        # va bien" (if it does well) should read as a realistic upside, not
        # an outlier best-case.
        "p75_views": float(np.percentile(views, 75)),
        "cvr_per_10k_views": summary["units_per_10k_views"],
        "by_month_category": by_month_category,
    }


def _category_priors(config: dict) -> dict[str, float]:
    creators_cfg = config["creators"][CREATOR]
    pooled = config["creators"]["pooled_category_gpm_per_1k_views"]
    weights_cfg = config["weights"]["fit"]
    # Every real category (any with a fastmoss_category_id -- core, secondary,
    # AND seasonal, whether or not it's active() this week), not just this
    # week's active set: normalize_priors min-max-scales across whatever's
    # passed in, so if the category set shifted week to week with the
    # seasonal rotation, every score would shift with it even with no real
    # change in her performance. Historical views/gpm are static regardless.
    all_real_categories = [k for k, m in config["categories"]["categories"].items() if "fastmoss_category_id" in m]
    raw = {
        cat: category_prior_raw(
            views_c=creators_cfg["category_views"].get(cat, 0),
            her_gpm_c=creators_cfg["category_gpm_per_1k_views"].get(cat, pooled.get(cat, 0)),
            pooled_gpm_c=pooled.get(cat, 0),
            k=weights_cfg["shrink_k_views"],
        )
        for cat in all_real_categories
    }
    return normalize_priors(raw)


def score_pool(pool: list[dict], config: dict, creator_stats: dict, today: date) -> pd.DataFrame:
    weights = config["weights"]
    settings = config["settings"]
    category_priors = _category_priors(config)
    creators_cfg = config["creators"][CREATOR]
    season_events = config["seasons"]["events"]

    rows = []
    for c in pool:
        slope14 = slope_log1p(c["daily_units_14"]) if c.get("daily_units_14") else 0.0
        accel = acceleration(c["daily_units_14"]) if c.get("daily_units_14") and len(c["daily_units_14"]) >= 14 else 0.0
        wow_val = wow(c["units_7d"], units_7d_prev=None, growth_rate_fallback=c["growth_rate"])
        has_daily = bool(c.get("daily_units_14"))
        has_lead = "lead_signal" in c

        creator_count = c.get("creator_count")
        demand_per_creator_raw = (c["units_7d"] / max(creator_count, 1)) if creator_count else float(c["units_7d"])

        earnings = earnings_per_sale(c["price"], c["commission_rate"])

        # Per price_group sweet spot (fashion/furniture/home -- added
        # 2026-10-18, replacing one global $25-55 range once furniture
        # joined the target list: a $300 bed and a $40 dress can't share a
        # sweet spot).
        category_meta = config["categories"]["categories"].get(c["config_category"], {})
        price_fit = blended_price_fit(
            price=c["price"],
            creator_log_mean=math.log(creators_cfg["price_fit_log_mean_usd"]),
            n_tracked_videos=creator_stats["n_tracked_videos"],
            sweet_spot_usd=price_sweet_spot_for_category(category_meta, config["categories"]["price_sweet_spot_usd"]),
            sigma=weights["fit"]["price_fit_sigma"],
            min_tracked_videos=weights["fit"]["min_tracked_videos_for_own_price_fit"],
        )
        target_boost = target_category_boost(
            c["config_category"], settings["target_categories"], weights["fit"]["target_category_boost"]
        )
        demographic_component = demographic_fit_heuristic(
            c["title"], c["category_l1"] or "", boost=weights["fit"]["demographic_fit_heuristic_boost"]
        )
        spanish_component = (1 - c["spanish_share"]) if c.get("spanish_share") is not None else None
        aud_fit = audience_fit(
            spanish_component,
            demographic_component,
            spanish_weight=weights["fit"]["audience_fit_weights"]["spanish"],
            demographic_weight=weights["fit"]["audience_fit_weights"]["demographic"],
        )
        fit_raw = fit_score(
            category_prior_norm=category_priors.get(c["config_category"], 0.5),
            price_fit=price_fit,
            audience_fit=aud_fit,
            target_boost=target_boost,
            category_prior_weight=weights["fit"]["weights"]["category_prior"],
            price_fit_weight=weights["fit"]["weights"]["price_fit"],
            audience_fit_weight=weights["fit"]["weights"]["audience_fit"],
        )

        # Title-keyword event identity (2026-10-15/16), computed before the
        # category match below: a Halloween costume is category-tagged
        # "womens_clothing" by FastMoss, not "seasonal", so a broad category
        # match would let it ALSO pick up Black Friday's boost just because
        # that category happens to overlap -- the real case that produced a
        # "Black Friday in 49 days" reason on a Halloween cowboy costume.
        # When a title keyword identifies the product with high confidence,
        # that identity overrides the category match entirely (for scoring,
        # not just the pick cap below).
        keyword_matched_events = [
            e for e in season_events if e.get("title_keywords") and title_matches_event_keywords(c["title"], e["title_keywords"])
        ]
        capped_event_ids = [e["id"] for e in keyword_matched_events if e.get("max_picks") is not None]

        matching_events = (
            keyword_matched_events
            if keyword_matched_events
            else [
                e
                for e in season_events
                if c["config_category"] in e.get("categories", []) and e.get("film_start") and e.get("film_end")
            ]
        )
        extra = weights["seasonality_extra"]
        best_event: dict | None = None
        event_val = 0.0
        days_to_event: int | None = None
        for e in matching_events:
            film_start = date.fromisoformat(e["film_start"])
            film_end = date.fromisoformat(e["film_end"])
            raw = event_term(today, film_start, film_end, weights["seasonality"]["event_lookahead_days"])
            ending_factor = season_ending_factor(today, film_end, extra["season_ending_warning_days"], extra["season_ending_floor"])
            boost = boosted_category_multiplier(
                c["config_category"], e.get("boosted_categories", []), extra["boosted_category_multiplier"]
            )
            adjusted = raw * ending_factor * boost
            if best_event is None or adjusted > event_val:
                event_val = adjusted
                best_event = e
                # The reason's countdown should name the day people actually
                # recognize (e.g. Black Friday itself), not film_end -- the
                # film window deliberately runs past the holiday so she keeps
                # posting through Cyber Monday, which isn't what "in 49 days"
                # should be counting down to (added 2026-10-16, real case:
                # bfcm_2026's film_end is Dec 2 but Black Friday 2026 is Nov 27).
                anchor = date.fromisoformat(e["event_date"]) if e.get("event_date") else film_end
                days_to_event = (anchor - today).days
        month_gmv = creator_stats["by_month_category"].get(today.month, {})
        personal_val = personal_term(
            category_month_gmv=month_gmv.get(c["config_category"], 0.0),
            total_month_gmv=sum(month_gmv.values()),
            n_categories=max(len(month_gmv), 1),
        )
        season_weights = weights["seasonality"]["weights"]
        season_val = seasonality_score(event_val, personal_val, season_weights["event"], season_weights["personal"])

        is_new = creator_count is not None and creator_count < 5  # cold-start proxy, no category percentile yet
        category_gpm = creators_cfg["category_gpm_per_1k_views"].get(
            c["config_category"], config["creators"]["pooled_category_gpm_per_1k_views"].get(c["config_category"], 0.0)
        )
        rows.append(
            {
                **c,
                "demand_raw": demand(c["units_7d"]),
                "slope14": slope14,
                "wow": wow_val,
                "accel": accel,
                "has_daily": has_daily,
                "lead_signal": c.get("lead_signal", 0.0),
                "has_lead": has_lead,
                "log_earnings_raw": log_earnings(earnings),
                "earnings_per_sale": earnings,
                "demand_per_creator_raw": math.log1p(demand_per_creator_raw),
                "saturation_raw": 0.0,  # first run: no prior-week creator_count to compute growth from
                "fit_raw": fit_raw,
                "category_gpm": category_gpm,
                "category_label_es": category_meta.get("label_es", c["config_category"]),
                "category_label_en": category_meta.get("label_en", c["config_category"]),
                "event_val": event_val,
                "personal_val": personal_val,
                "season_val": season_val,
                "matched_event_id": best_event["id"] if best_event and event_val > 0 else None,
                "matched_event_label_es": best_event["label_es"] if best_event and event_val > 0 else None,
                "matched_event_label_en": best_event["label_en"] if best_event and event_val > 0 else None,
                "days_to_event_end": days_to_event if event_val > 0 else None,
                "capped_event_ids": capped_event_ids,
                "is_new": is_new,
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    for raw_col, z_col in [
        ("demand_raw", "z_demand"),
        ("slope14", "z_slope14"),
        ("wow", "z_wow"),
        ("accel", "z_accel"),
        ("log_earnings_raw", "z_log_earnings"),
        ("demand_per_creator_raw", "z_log_demand_per_creator"),
        ("saturation_raw", "z_saturation"),
        ("fit_raw", "z_fit"),
        ("lead_signal", "z_lead"),
    ]:
        df[z_col] = grouped_robust_z(df, raw_col, "config_category", min_group_size=weights["zscore"]["min_group_size"])

    df["momentum"] = df.apply(
        lambda r: momentum(
            z_wow=r["z_wow"],
            z_slope14=r["z_slope14"] if r["has_daily"] else None,
            z_accel=r["z_accel"] if r["has_daily"] else None,
            z_lead=r["z_lead"] if r["has_lead"] else None,  # only set for the overview-enriched subset
            slope14_weight=weights["momentum"]["slope14_weight"],
            wow_weight=weights["momentum"]["wow_weight"],
            accel_weight=weights["momentum"]["accel_weight"],
            lead_weight=weights["momentum"]["lead_weight"],
        ),
        axis=1,
    )
    df["opportunity_val"] = df.apply(
        lambda r: opportunity(r["z_log_demand_per_creator"], r["z_saturation"], weights["opportunity"]["saturation_weight"]),
        axis=1,
    )
    df["spanish_gap_raw"] = df.apply(
        # pandas coerces a column mixing None and float to NaN -- `is not None`
        # does not catch that (nan is not None is True), so this must use
        # pd.notna(); that gap caused a real NaN-propagation bug here once.
        lambda r: spanish_gap(r["z_demand"], r["spanish_share"] if pd.notna(r["spanish_share"]) else 0.5),
        axis=1,
    )
    min_group_size = weights["zscore"]["min_group_size"]
    df["z_spanish_gap"] = grouped_robust_z(df, "spanish_gap_raw", "config_category", min_group_size=min_group_size)

    category_group = df.groupby("config_category")
    df["category_units_7d_median"] = category_group["units_7d"].transform("median")
    df["category_units_7d_p75"] = category_group["units_7d"].transform(lambda s: s.quantile(0.75))
    df["category_creator_count_p40"] = category_group["creator_count"].transform(lambda s: s.fillna(s.median()).quantile(0.40))
    df["category_creator_count_p95"] = category_group["creator_count"].transform(lambda s: s.fillna(s.median()).quantile(0.95))

    def _row_risk(r: pd.Series) -> float:
        creator_pct = None
        if pd.notna(r["creator_count"]) and pd.notna(r["category_creator_count_p95"]) and r["category_creator_count_p95"] > 0:
            creator_pct = min(r["creator_count"] / r["category_creator_count_p95"], 1.0)
        return risk_penalty(
            earnings_per_sale_usd=r["earnings_per_sale"],
            price_cv_4wk=None,
            rating=None,
            creator_count_percentile=creator_pct,
            unit_price_usd=r["price"],
            commission_rate_pct=r["commission_rate"] * 100,
            ads_share_pct=r["ads_share_pct"],
            low_earnings_threshold=weights["earnings"]["min_earnings_per_sale_usd"],
            low_earnings_penalty=weights["risk"]["low_earnings_penalty"],
            price_cv_threshold=weights["risk"]["price_volatility_cv_threshold"],
            price_cv_penalty=weights["risk"]["price_volatility_penalty"],
            low_rating_threshold=weights["risk"]["low_rating_threshold"],
            low_rating_penalty=weights["risk"]["low_rating_penalty"],
            high_creator_pct_threshold=weights["risk"]["high_creator_saturation_percentile"],
            high_creator_pct_penalty=weights["risk"]["high_creator_saturation_penalty"],
            low_price_threshold_usd=weights["risk"]["low_unit_price_usd"],
            low_price_penalty=weights["risk"]["low_unit_price_penalty"],
            low_price_commission_exempt_pct=weights["risk"]["low_unit_price_commission_exempt_pct"],
            high_ads_share_pct_threshold=weights["risk"]["high_ads_share_pct_threshold"],
            high_ads_share_penalty=weights["risk"]["high_ads_share_penalty"],
        )

    df["risk"] = df.apply(_row_risk, axis=1)

    def _row_stage(r: pd.Series) -> str:
        return classify_stage(
            units_7d=r["units_7d"],
            category_median_units_7d=r["category_units_7d_median"],
            category_units_7d_p75=r["category_units_7d_p75"],
            slope14=r["slope14"],
            creator_count=int(r["creator_count"]) if pd.notna(r["creator_count"]) else 999,
            category_creator_count_p40=r["category_creator_count_p40"] if pd.notna(r["category_creator_count_p40"]) else 0,
            saturation=r["saturation_raw"],
            weeks_tracked_last_8=1,  # first run: this is the only week tracked so far
            recent_declining_runs=0,
            rank_delta=None,
            emerging_slope_min=weights["stages"]["emerging"]["slope14_min"],
            rising_slope_min=weights["stages"]["rising"]["slope14_min"],
            peak_slope_abs_max=weights["stages"]["peak"]["slope14_abs_max"],
            evergreen_weeks_tracked_min=weights["stages"]["evergreen"]["weeks_tracked_min"],
            evergreen_slope_abs_max=weights["stages"]["evergreen"]["slope14_abs_max"],
            declining_slope_max=weights["stages"]["declining"]["slope14_max"],
            declining_consecutive_runs=weights["stages"]["declining"]["consecutive_runs"],
            declining_rank_drop_min=weights["stages"]["declining"]["rank_drop_min"],
        )

    df["stage"] = df.apply(_row_stage, axis=1)

    df["score"] = df.apply(
        lambda r: composite_score(
            z_demand=r["z_demand"],
            momentum=r["momentum"],
            z_log_earnings=r["z_log_earnings"],
            opportunity_value=r["opportunity_val"],
            z_fit=r["z_fit"],
            seasonality_value=r["season_val"],
            z_spanish_gap=r["z_spanish_gap"],
            risk=r["risk"],
            demand_weight=weights["composite"]["demand"],
            momentum_weight=weights["composite"]["momentum"],
            log_earnings_weight=weights["composite"]["log_earnings"],
            opportunity_weight=weights["composite"]["opportunity"],
            fit_weight=weights["composite"]["fit"],
            seasonality_weight=weights["composite"]["seasonality"],
            spanish_gap_weight=weights["composite"]["spanish_gap"],
            risk_weight=weights["composite"]["risk_penalty"],
        ),
        axis=1,
    )

    m_mult_coef = weights["expected_value"]["momentum_multiplier"]
    s_mult_coef = weights["expected_value"]["saturation_multiplier"]

    def _row_ev(r: pd.Series, views: float) -> float:
        m_mult = momentum_multiplier(r["slope14"], m_mult_coef["slope14_coef"], m_mult_coef["min"], m_mult_coef["max"])
        s_mult = saturation_multiplier(r["z_saturation"], s_mult_coef["coef"], s_mult_coef["min"], s_mult_coef["max"])
        return expected_value(views, creator_stats["cvr_per_10k_views"], r["price"], r["commission_rate"], m_mult, s_mult)

    df["ev_typical"] = df.apply(lambda r: _row_ev(r, creator_stats["median_views"]), axis=1)
    df["ev_upside"] = df.apply(lambda r: _row_ev(r, creator_stats["p75_views"]), axis=1)

    return df


def build_reasons(
    row: pd.Series,
    creator_avg_gpm: float | None = None,
    spanish_gap_reason_max_share: float = 0.3,
    exclude: frozenset[str] = frozenset(),
) -> tuple[list[str], list[str]]:
    """`creator_avg_gpm` (added 2026-10-15, engine.fit.creator_avg_category_gpm):
    the "fit" component only renders as the category_fit reason -- citing her
    own $-per-1,000-views for this category -- when that number beats her own
    overall average; a below-average number would undersell the pick rather
    than support it. When it doesn't beat the average (or `creator_avg_gpm`
    isn't given), "fit" is skipped and the next-strongest remaining component
    takes its slot instead, same as when a selected component turns out to
    have no data to render (e.g. no Spanish-gap videos fetched).

    `spanish_gap_reason_max_share` (added 2026-10-16): the "spanish_gap"
    reason only renders when `spanish_share` is actually low -- at or above
    this share there's no real gap left to call out. Also fixes a real
    count-inversion bug: the reason used to print the NON-Spanish count
    while the sentence reads as "X of Y are in Spanish," so a product with
    zero Spanish videos said "10 of 10" -- literally the opposite of what it
    meant.

    `exclude` (added 2026-10-16): component names to drop before ranking --
    used for the simplified card's one-sentence summary, which must not
    repeat the earnings reason since that's already the card's own headline
    ("Ganas $X por venta")."""
    components = {
        "momentum": row["wow"],
        "earnings": row["earnings_per_sale"] - 1.5,  # magnitude relative to the "worth it" floor
        "spanish_gap": row["z_spanish_gap"],
        "seasonality": row["season_val"],
        "fit": row["z_fit"],
    }
    for key in exclude:
        components.pop(key, None)
    ranked = select_top_reasons(components, max_reasons=len(components))
    reasons_es, reasons_en = [], []
    for comp in ranked:
        if len(reasons_es) >= 3:
            break
        try:
            if comp == "momentum":
                reasons_es.append(render_reason("momentum", "es", pct=row["wow"] * 100))
                reasons_en.append(render_reason("momentum", "en", pct=row["wow"] * 100))
            elif comp == "earnings":
                reasons_es.append(render_reason("earnings", "es", amount=row["earnings_per_sale"]))
                reasons_en.append(render_reason("earnings", "en", amount=row["earnings_per_sale"]))
            elif (
                comp == "spanish_gap"
                and pd.notna(row.get("spanish_share"))
                and row["spanish_share"] < spanish_gap_reason_max_share
            ):
                total = int(row.get("spanish_video_count") or 0)
                n_es = round(row["spanish_share"] * total)  # count of Spanish videos, not non-Spanish (was inverted)
                reasons_es.append(render_reason("spanish_gap", "es", n=n_es, total=total))
                reasons_en.append(render_reason("spanish_gap", "en", n=n_es, total=total))
            elif (
                comp == "seasonality"
                and pd.notna(row.get("matched_event_id"))
                and pd.notna(row.get("days_to_event_end"))
                and int(row["days_to_event_end"]) >= 0
            ):
                days = int(row["days_to_event_end"])
                reasons_es.append(
                    render_reason(
                        "seasonality", "es", event=row["matched_event_label_es"], days_phrase=days_remaining_phrase(days, "es")
                    )
                )
                reasons_en.append(
                    render_reason(
                        "seasonality", "en", event=row["matched_event_label_en"], days_phrase=days_remaining_phrase(days, "en")
                    )
                )
            elif comp == "fit" and creator_avg_gpm is not None and row["category_gpm"] > creator_avg_gpm:
                # cites her own real category_gpm (GMV per 1,000 views), not
                # a vague "this works for you" (fixed 2026-10-15, every other
                # reason already cited a real number, this one didn't).
                reasons_es.append(
                    render_reason("category_fit", "es", category_label=row["category_label_es"], gpm=row["category_gpm"])
                )
                reasons_en.append(
                    render_reason("category_fit", "en", category_label=row["category_label_en"], gpm=row["category_gpm"])
                )
        except KeyError:
            continue
    return reasons_es, reasons_en


# ---------------------------------------------------------------------------
# Picks assembly
# ---------------------------------------------------------------------------


def assemble_picks(
    df: pd.DataFrame,
    weights: dict,
    season_events: list[dict] | None = None,
    categories_cfg: dict | None = None,
) -> list[dict]:
    if df.empty:
        return []
    records = df.to_dict("records")
    for r in records:
        r["category"] = r["config_category"]
    ranked = compute_blended_ranks(records)
    # Per-event pick caps (section 6.7 extended, 2026-10-15): only events that
    # declare their own `max_picks` in config/seasons.yaml are capped (e.g.
    # Halloween, this close to film_end) -- a broad boost like bfcm_2026 that
    # matches most candidates must stay uncapped, see filter_diverse_topn.
    event_caps = {e["id"]: e["max_picks"] for e in (season_events or []) if e.get("max_picks") is not None}
    max_per_category = weights["picks"]["max_per_category"]
    max_per_shop = weights["picks"]["max_per_shop"]
    max_per_brand = weights["picks"]["max_per_brand"]
    title_jaccard_threshold = weights["picks"]["title_jaccard_duplicate_threshold"]
    diverse = filter_diverse_topn(
        ranked,
        n=weights["picks"]["core_slots"] + weights["picks"]["explore_slots"] + weights["picks"]["evergreen_slots"],
        max_per_category=max_per_category,
        max_per_shop=max_per_shop,
        max_per_brand=max_per_brand,
        title_jaccard_threshold=title_jaccard_threshold,
        event_caps=event_caps,
    )

    categories = sorted(df["config_category"].unique())
    beliefs = {c: (1.0, 1.0) for c in categories}  # first run: no history, uniform Beta(1,1) prior
    sampled = thompson_sample_categories(beliefs)
    explore_cats = pick_explore_categories(sampled, trial_counts=dict.fromkeys(categories, 0), k=weights["picks"]["explore_slots"])
    core_slots_n = weights["picks"]["core_slots"]
    core_selected = diverse[:core_slots_n]
    # Guarantee minimum representation for Moda-core (fajas/vestidos/conjuntos
    # -- the 3 core-tier fashion categories) and Hogar (added 2026-10-19, real
    # case: 2026-W42's Top 9 had zero of the former and too little of the
    # latter). Skipped when categories_cfg isn't supplied (e.g. older tests
    # that don't care about this) or no minimums are configured. The result
    # is spliced back into `diverse` itself, not just `core_selected` -- the
    # "core" picks below use `diverse` (via build_top10) as their
    # ranked/ordered source, so a swap that only touched `core_selected`
    # would get silently discarded once `diverse`'s own, unswapped head was
    # re-read further down.
    if categories_cfg is not None:
        min_moda_core = weights["picks"].get("min_moda_core_picks", 0)
        min_hogar = weights["picks"].get("min_hogar_picks", 0)
        requirements = [
            (lambda meta: meta.get("group") == "fashion" and meta.get("tier") == "core", min_moda_core),
            (lambda meta: meta.get("group") == "home", min_hogar),
        ]
        core_selected = enforce_group_minimums(
            core_selected,
            ranked,
            categories_cfg,
            requirements,
            max_per_category=max_per_category,
            max_per_shop=max_per_shop,
            max_per_brand=max_per_brand,
            title_jaccard_threshold=title_jaccard_threshold,
        )
        core_ids = {c["product_id"] for c in core_selected}
        diverse = core_selected + [c for c in diverse[core_slots_n:] if c["product_id"] not in core_ids]
    used_ids = {c["product_id"] for c in core_selected}
    # Diversity and event caps must carry over from the core selection into
    # explore too (added 2026-10-15, extended 2026-10-19 for brand + the
    # near-duplicate title check): explore candidates come straight from
    # `ranked`, not from `diverse`, so without this a 4th shapewear pick (over
    # max_per_category=3), a 2nd Halloween costume (over Halloween's
    # max_picks=1), or a near-duplicate of a core pick (real case: a core
    # Crocs clog and a near-identical Crocs clog in explore, since this loop
    # never checked title similarity against the core selection at all)
    # could still slip in through the explore slot.
    category_counts: dict[str, int] = {}
    shop_counts: dict[str, int] = {}
    brand_counts: dict[str, int] = {}
    event_counts: dict[str, int] = {}
    for c in core_selected:
        category_counts[c["category"]] = category_counts.get(c["category"], 0) + 1
        shop_counts[c["shop_id"]] = shop_counts.get(c["shop_id"], 0) + 1
        brand_counts[extract_brand(c["title"])] = brand_counts.get(extract_brand(c["title"]), 0) + 1
        for eid in candidate_event_ids(c):
            if eid in event_caps:
                event_counts[eid] = event_counts.get(eid, 0) + 1
    explore_candidates: list[dict] = []
    for c in ranked:
        if len(explore_candidates) >= weights["picks"]["explore_slots"]:
            break
        if c["config_category"] not in explore_cats or c["product_id"] in used_ids:
            continue
        if category_counts.get(c["category"], 0) >= max_per_category:
            continue
        if shop_counts.get(c["shop_id"], 0) >= max_per_shop:
            continue
        brand = extract_brand(c["title"])
        if brand_counts.get(brand, 0) >= max_per_brand:
            continue
        ids = candidate_event_ids(c)
        if any(eid in event_caps and event_counts.get(eid, 0) >= event_caps[eid] for eid in ids):
            continue
        if any(is_near_duplicate(c["title"], s["title"], title_jaccard_threshold) for s in core_selected + explore_candidates):
            continue
        explore_candidates.append(c)
        category_counts[c["category"]] = category_counts.get(c["category"], 0) + 1
        shop_counts[c["shop_id"]] = shop_counts.get(c["shop_id"], 0) + 1
        brand_counts[brand] = brand_counts.get(brand, 0) + 1
        for eid in ids:
            if eid in event_caps:
                event_counts[eid] = event_counts.get(eid, 0) + 1

    picks = build_top10(
        ranked_diverse_candidates=diverse,
        explore_candidates=explore_candidates,
        evergreen_candidate=None,  # first run: no outcome history for a "winner trending again"
        core_slots=weights["picks"]["core_slots"],
        explore_slots=weights["picks"]["explore_slots"],
        evergreen_slots=0,  # no evergreen candidate available yet this run
    )
    return picks


def _video_card_dicts(videos: list[dict] | None, limit: int) -> list[dict]:
    return [
        {
            "video_id": v["video_id"],
            "cover_url": v.get("cover_url") or "",
            "tiktok_url": v.get("tiktok_url") or "",
            "creator_handle": v.get("creator_handle") or "",
            "play_count": v.get("play_count", 0),
            "window_gmv": v.get("window_gmv", 0.0),
            "window_units_sold": v.get("window_units_sold", 0),
        }
        for v in (videos or [])[:limit]
    ]


def picks_to_export_dicts(
    picks: list[dict], creator_avg_gpm: float | None = None, spanish_gap_reason_max_share: float = 0.3
) -> list[dict]:
    out = []
    for p in picks:
        row = pd.Series(p)
        reasons_es, reasons_en = build_reasons(row, creator_avg_gpm, spanish_gap_reason_max_share)
        # The simplified card (added 2026-10-16) shows ONE plain sentence
        # instead of a bullet list, combining the non-earnings reasons --
        # earnings is already the card's own headline ("Ganas $X por venta").
        summary_reasons_es, summary_reasons_en = build_reasons(
            row, creator_avg_gpm, spanish_gap_reason_max_share, exclude=frozenset({"earnings"})
        )
        out.append(
            {
                "slot": p["slot"],
                "kind": p["kind"],
                "product_id": p["product_id"],
                "title": p["title"],
                "clean_title": clean_title(p["title"]),
                "image_url": p.get("image_url") or "",
                "category": p["config_category"],
                "shop_name": p["shop_name"],
                "price": p["price"],
                "commission_rate": p["commission_rate"],
                "earnings_per_sale": round(p["earnings_per_sale"], 2),
                "stage": p["stage"],
                "score": int(p["score"]),
                "ev_typical": round(p["ev_typical"], 2),
                "ev_upside": round(p["ev_upside"], 2),
                "reasons_es": reasons_es,
                "reasons_en": reasons_en,
                "summary_es": join_reasons_as_sentence(summary_reasons_es, "es"),
                "summary_en": join_reasons_as_sentence(summary_reasons_en, "en"),
                "videos": _video_card_dicts(p.get("videos"), limit=3),
                "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=p["product_id"]),
            }
        )
    return out


def product_detail_dict(cand: dict, categories_cfg: dict, is_pick: bool, has_enrichment: bool) -> dict:
    """Full product-page detail (redesigned 2026-10-18 for the "Todos" full
    list: written for every clean candidate, not just the ~9 final picks,
    since any row there links to its own product page). Stat boxes (sold
    this week, total sales, commission, earnings, creators, videos) show for
    every product; `has_enrichment` (the top-15 by preliminary score that
    got trend + product_video_list) gates the 14-day chart and the embedded
    video gallery, which only exist for those."""
    cat_meta = categories_cfg.get(cand["config_category"], {})
    title = cand["title"]
    clean = clean_title(title)
    daily_units_14 = cand.get("daily_units_14") if isinstance(cand.get("daily_units_14"), list) else []
    return {
        "product_id": cand["product_id"],
        "title": title,
        "clean_title": clean,
        "image_url": cand.get("image_url") or "",
        "category": cand["config_category"],
        "category_label_es": cat_meta.get("label_es", cand["config_category"]),
        "category_label_en": cat_meta.get("label_en", cand["config_category"]),
        "shop_name": cand["shop_name"],
        "price": cand["price"],
        "commission_rate": cand["commission_rate"],
        "earnings_per_sale": round(earnings_per_sale(cand["price"], cand["commission_rate"]), 2),
        "units_7d": cand.get("units_7d", 0),
        "units_total": cand.get("units_total", 0),
        "creator_count": cand.get("creator_count") if has_enrichment else None,
        "video_count": cand.get("video_count") if has_enrichment else None,
        "daily_units_14": daily_units_14 if has_enrichment else [],
        "is_pick": is_pick,
        "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=cand["product_id"]),
        "tiktok_search_url": tiktok_search_url(clean),
        "videos": _video_card_dicts(cand.get("videos"), limit=6) if has_enrichment else [],
    }


def cache_pick_images(picks: list[dict]) -> None:
    """Downloads each pick's product photo and video thumbnails into
    web/public/img/ (added 2026-10-16) so the dashboard never depends on
    hotlinking FastMoss's/TikTok's CDN; mutates `picks` in place, falling
    back to the original remote url on any download failure."""
    for p in picks:
        cached = cache_image(p.get("image_url"), f"product_{p['product_id']}")
        if cached:
            p["image_url"] = cached
        for v in p.get("videos") or []:
            cached_cover = cache_image(v.get("cover_url"), f"video_{v['video_id']}")
            if cached_cover:
                v["cover_url"] = cached_cover


def candidates_to_export_dicts(
    df: pd.DataFrame, categories_cfg: dict, pick_ids: set[str], flagged: list[dict] | None = None
) -> list[dict]:
    """The "Todos" page's full list (redesigned 2026-10-18): every clean
    candidate (not a trimmed pool), ranked rows grouped by categories.yaml's
    "group" (Moda/Hogar), her actual picks starred via `is_pick`. Suspicious
    candidates are still included (with their reasons) so they're visible,
    not just silently dropped, same as before."""
    out = []
    for _, r in df.iterrows():
        cat_meta = categories_cfg.get(r["config_category"], {})
        title = r["title"]
        clean = clean_title(title)
        out.append(
            {
                "product_id": r["product_id"],
                "title": title,
                "clean_title": clean,
                "image_url": r.get("image_url") or "",
                "category": r["config_category"],
                "category_label_es": cat_meta.get("label_es", r["config_category"]),
                "category_label_en": cat_meta.get("label_en", r["config_category"]),
                "group": cat_meta.get("group", "fashion"),
                "shop_name": r["shop_name"],
                "stage": r["stage"],
                "rank": int(r["rank"]),
                "price": r["price"],
                "commission_rate": r["commission_rate"],
                "earnings_per_sale": round(r["earnings_per_sale"], 2),
                "units_7d": int(r["units_7d"]),
                "units_total": int(r["units_total"]),
                "score": int(r["score"]),
                "ev_typical": round(r["ev_typical"], 2),
                # A candidate outside the enrichment shortlist never gets
                # daily_units_14 set at all, which pandas backfills as NaN
                # (not None) in the DataFrame column -- `or []` doesn't
                # catch that (nan is truthy), so json.dumps wrote a literal
                # `NaN` token, invalid JSON that broke JSON.parse on the
                # whole file (found 2026-10-17 verifying the Radar page).
                "daily_units": r["daily_units_14"] if isinstance(r["daily_units_14"], list) else [],
                "is_pick": r["product_id"] in pick_ids,
                "has_enrichment": bool(pd.notna(r.get("creator_count"))),
                "suspicious": False,
                "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=r["product_id"]),
                "tiktok_search_url": tiktok_search_url(clean),
            }
        )
    # Suspicious listings (added 2026-10-15): excluded from scoring, kept
    # here with their reasons so they're visible rather than silently
    # dropped (spec'd as "exclude + record reason in candidates.json").
    for c in flagged or []:
        cat_meta = categories_cfg.get(c["config_category"], {})
        title = c["title"]
        clean = clean_title(title)
        out.append(
            {
                "product_id": c["product_id"],
                "title": title,
                "clean_title": clean,
                "image_url": c.get("image_url") or "",
                "category": c["config_category"],
                "category_label_es": cat_meta.get("label_es", c["config_category"]),
                "category_label_en": cat_meta.get("label_en", c["config_category"]),
                "group": cat_meta.get("group", "fashion"),
                "shop_name": c["shop_name"],
                "stage": None,
                "rank": c.get("rank", 0),
                "price": c["price"],
                "commission_rate": c["commission_rate"],
                "earnings_per_sale": round(earnings_per_sale(c["price"], c["commission_rate"]), 2),
                "units_7d": c.get("units_7d", 0),
                "units_total": c.get("units_total", 0),
                "score": None,
                "ev_typical": None,
                "daily_units": [],
                "is_pick": False,
                "has_enrichment": False,
                "suspicious": True,
                "suspicious_reasons": c["suspicious_reasons"],
                "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=c["product_id"]),
                "tiktok_search_url": tiktok_search_url(clean),
            }
        )
    return out


def print_picks(picks: list[dict]) -> None:
    print(f"\n{'=' * 70}\nTop {len(picks)} for @{CREATOR} this week\n{'=' * 70}")
    for p in picks:
        print(f"\n[{p['slot']}] {p['title'][:70]}  (score {p['score']}, {p['kind']}/{p['stage']})")
        print(f"    ${p['price']:.2f} @ {p['commission_rate']*100:.0f}% = ${p['earnings_per_sale']:.2f}/sale")
        print(f"    EV typical: ${p['ev_typical']:.0f}  if it takes off: ${p['ev_upside']:.0f}")
        for r_es, r_en in zip(p["reasons_es"], p["reasons_en"], strict=True):
            print(f"    - {r_es} / {r_en}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


async def run(args: argparse.Namespace) -> None:
    config = load_all()
    today = now_eastern().date()
    week = args.resume_week or args.week or iso_week_label(today)
    date_value = last_completed_week_value(today)
    run_id = f"{week}-{uuid.uuid4().hex[:8]}"

    client_cm = FixtureReplayClient(DRY_RUN_FIXTURES) if args.dry_run else FastMossClient()

    df = pd.DataFrame()
    flagged: list[dict] = []
    async with client_cm as client:
        starting_balance = await check_balance(client)
        tracker = BudgetTracker(hard_cap=args.budget, starting_balance=starting_balance, run_id=run_id)

        try:
            if args.resume_week:
                # Rebuild from already-paid-for snapshots instead of
                # re-ingesting (e.g. recovering from a scoring-side bug
                # without spending the ~50+ credits a fresh ingest costs).
                # Try every category key regardless of today's active()
                # window -- the snapshot files on disk are the real record
                # of what that run actually fetched; a missing one just
                # yields zero candidates for that key (load_raw_snapshot
                # returns None gracefully).
                category_keys = (
                    DRY_RUN_CATEGORY_KEYS
                    if args.dry_run
                    else [k for k, m in config["categories"]["categories"].items() if "fastmoss_category_id" in m]
                )
                pool = ingest_from_snapshots(args.resume_week, category_keys)
            else:
                pool = await ingest(client, config, week, date_value, today, tracker, args.dry_run)
            # Suspicious-listing filter (added 2026-10-15): exclude from
            # scoring/picks, but keep (with reasons) for export so they're
            # visible rather than silently dropped.
            pool, flagged = partition_suspicious(pool, config["weights"])
            creator_stats = _creator_stats(config)
            df = score_pool(pool, config, creator_stats, today)

            # Cached here (on the raw candidate dicts, before `df` derives
            # from them) so every clean + suspicious candidate's photo and
            # video thumbnails are local by the time `score_pool` builds the
            # DataFrame export functions read from -- added 2026-10-18 for
            # the "Todos" full list, which shows a photo for every row, not
            # just the ~9 final picks. Must run before the LAST score_pool
            # call below, not after, or `df`'s image_url stays the stale
            # remote one.
            cache_pick_images(pool + flagged)

            if not df.empty:
                prelim_ids = set(df.sort_values("score", ascending=False).head(SHORTLIST_SIZE)["product_id"])
                shortlist = [c for c in pool if c["product_id"] in prelim_ids]
                await enrich_shortlist(client, shortlist, week, tracker)
                # `shortlist` dicts are the same objects referenced in `pool` (shared,
                # not copied), so enrich_shortlist's mutation is already reflected
                # in `pool` -- just recompute scores from scratch with it filled in.
                cache_pick_images(shortlist)  # the new video thumbnails enrichment just added
                df = score_pool(pool, config, creator_stats, today)
        except BudgetExceeded as e:
            print(f"BUDGET STOP: {e}")

        final_balance = await check_balance(client)

    weights = config["weights"]
    categories_cfg = config["categories"]["categories"]
    picks = assemble_picks(df, weights, config["seasons"]["events"], categories_cfg) if not df.empty else []
    creators_cfg = config["creators"][CREATOR]
    creator_avg_gpm = creator_avg_category_gpm(
        creators_cfg["category_gpm_per_1k_views"], creators_cfg["category_views"]
    )
    spanish_gap_reason_max_share = weights["fit"]["spanish_gap_reason_max_share"]
    pick_ids = {p["product_id"] for p in picks}
    pick_dicts = picks_to_export_dicts(picks, creator_avg_gpm, spanish_gap_reason_max_share)
    candidate_dicts = candidates_to_export_dicts(df, categories_cfg, pick_ids, flagged)

    if not args.dry_run:
        export.write_picks(week, CREATOR, pick_dicts)
        export.write_candidates(week, candidate_dicts)
        # Every clean + suspicious candidate gets its own product page (not
        # just the ~9 picks) -- the "Todos" full list links to any of them.
        enriched_ids = {c["product_id"] for c in pool if isinstance(c.get("daily_units_14"), list)}
        for cand in pool:
            export.write_product(
                cand["product_id"],
                product_detail_dict(cand, categories_cfg, cand["product_id"] in pick_ids, cand["product_id"] in enriched_ids),
            )
        for cand in flagged:
            export.write_product(cand["product_id"], product_detail_dict(cand, categories_cfg, False, False))
        conn = connect(REPO_ROOT / "data" / "radar.db")
        for stage in tracker.stage_log:
            write_ledger_row(conn, run_id, stage["stage"], stage["credits"], True, stage["note"])
        export.write_meta(
            week=week,
            run_id=run_id,
            credits_used_this_run=tracker.spent,
            credits_used_this_week=credits_used_for_week(conn, week),
            credits_used_month=500 - final_balance,
            credits_balance=final_balance,
        )
        append_credit_log(
            run_id,
            today.isoformat(),
            tracker.spent,
            final_balance,
            f"Phase 1+2 real run: {len(pick_dicts)} picks from {len(df)} candidates. " + "; ".join(
                f"{s['stage']}={s['credits']}cr" for s in tracker.stage_log
            ),
        )

    if flagged:
        print(f"\nExcluded {len(flagged)} suspicious listing(s):")
        for c in flagged:
            print(f"  - {c['title'][:60]} ({c['shop_name']}): {'; '.join(c['suspicious_reasons'])}")

    if args.print_picks or args.dry_run:
        print_picks(pick_dicts)
    print(f"\nCredits this run: {tracker.spent} (cap {args.budget}). Balance: {final_balance}/500.")


def main() -> None:
    load_dotenv(REPO_ROOT / ".env")  # local dev only -- CI sets FASTMOSS_API_KEY directly, no .env file there
    parser = argparse.ArgumentParser(description="Product Radar weekly pipeline")
    parser.add_argument("--dry-run", action="store_true", help="replay fixtures, zero credits")
    parser.add_argument("--week", default=None, help="ISO week label, e.g. 2026-W43 (default: current)")
    parser.add_argument("--print-picks", action="store_true", help="print the Top 10 to stdout")
    parser.add_argument("--budget", type=int, default=90, help="hard credit cap for this run")
    parser.add_argument(
        "--resume-week",
        default=None,
        help="rebuild from data/snapshots/<week>/ instead of re-ingesting (still does spanish-gap for real)",
    )
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
