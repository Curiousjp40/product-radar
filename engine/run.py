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
import os
import random
import urllib.parse
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv

from engine import export
from engine.budget import (
    BudgetExceeded,
    BudgetTracker,
    MissingSnapshotError,
    append_credit_log,
    average_credits_per_run,
    check_balance,
    credits_used_for_week,
    dynamic_weekly_budget,
)
from engine.client import FastMossClient, FastMossError, FixtureReplayClient
from engine.config import load_all
from engine.creator_gap import pocas_creadoras_latinas
from engine.db import connect
from engine.earnings import EarningsFetchError, sync_mis_productos_earnings
from engine.features import acceleration, demand, lead_raw, momentum, momentum_multiplier, slope_log1p, wow
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
from engine.formula import formula_ganadora_dict
from engine.images import cache_image
from engine.ingest import (
    SNAPSHOTS_DIR,
    fetch_daily_trend,
    fetch_product_videos,
    fetch_top_selling,
    find_recent_snapshot,
    load_raw_snapshot,
    resolve_category_ids,
    save_raw_snapshot,
)
from engine.insights import summarize_creator
from engine.language import spanish_share
from engine.normalize import (
    normalize_rank_row,
    rank_videos_by_sales,
    trend_period_summary,
    video_cards_from_product_video_list,
)
from engine.picks import (
    build_top10,
    candidate_event_ids,
    compute_blended_ranks,
    enforce_group_maximum,
    enforce_group_minimums,
    filter_diverse_topn,
    is_near_duplicate,
    pick_explore_categories,
    render_reason,
    select_top_reasons,
    thompson_sample_categories,
)
from engine.posting_time import (
    best_live_time_for_l1,
    best_time_for_pool,
    best_video_time,
    heat_grid_cells,
    load_live_records,
    load_video_records,
    top_lives_for_l1,
)
from engine.quality import filter_off_category, shop_round_price_cluster_ids, suspicious_reasons
from engine.saturation import saturation_badge
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
# Confirmed 2026-10-15: tests/fixtures/fastmoss_video_search.json's own
# linked_products carry this exact pattern as `tiktok_product_url` for every
# product (e.g. product_id 1731262278839865452 ->
# ".../shop/pdp/1731262278839865452?source=product_detail") -- a real,
# already-fetched FastMoss field, not a guess, so the direct-link gap the
# comment above describes turned out to already be solved.
TIKTOK_SHOP_URL_TEMPLATE = "https://www.tiktok.com/shop/pdp/{product_id}"


def tiktok_search_url(clean_product_title: str) -> str:
    return TIKTOK_SEARCH_URL_TEMPLATE.format(query=urllib.parse.quote(clean_product_title))


def tiktok_shop_url(product_id: str) -> str:
    return TIKTOK_SHOP_URL_TEMPLATE.format(product_id=product_id)

# Dry-run only has Phase 0's real fixtures for one category (shapewear) -- it
# proves the pipeline wiring works end to end on real-shaped data at zero
# credits, not a realistic multi-category simulation. The real run spans
# whichever categories.yaml categories are active() for `today` (below).
DRY_RUN_CATEGORY_KEYS = ["shapewear"]
# Superseded 2026-10-15 (Part 1c) by config/weights.yaml's `enrichment`
# section (video_tier_size/trend_tier_size) -- kept only as the fallback
# default if that config is ever missing. The old fixed SHORTLIST_SIZE=12
# (every one of the 12 got BOTH trend + video) is why only 29 of 250
# products ever had videos: tiered enrichment now spends the 1-credit
# product_video_list call on a wider pool (video_tier_size, e.g. 30) and
# reserves the 2-credit sales_trend call for just the top trend_tier_size
# (e.g. 15) -- see enrich_shortlist's docstring.
SHORTLIST_SIZE = 12


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
            cards = rank_videos_by_sales(video_cards_from_product_video_list(videos_raw))
            cand["videos"] = cards
            captions = [v["caption_text"] for v in cards]
            cand["spanish_share"] = spanish_share(captions)
            cand["spanish_video_count"] = len(captions)

    return candidates


async def enrich_shortlist(
    client,
    shortlist: list[dict],
    week: str,
    tracker: BudgetTracker,
    resume_mode: bool = False,
    trend_tier_size: int = 15,
    cache_max_weeks_old: int = 4,
    today: date | None = None,
) -> None:
    """Trend (14-day chart + creator/video counts, section 6.2/6.3/6.5) and
    video cards + Spanish-gap signal (section 6.8) for `shortlist` (score
    order, widest tier -- see `video_tier_size` at the call site). Tiered
    since 2026-10-15 (Part 1c): only the top `trend_tier_size` candidates
    get the 2-credit sales_trend call at all -- lower-ranked ones in
    `shortlist` only ever get the 1-credit product_video_list call, since a
    real month (283cr, 4 Mondays) couldn't afford trend for everyone who'd
    benefit from at least having videos/hashtags.

    Reuses a RECENT (not just this week's) snapshot before making a paid
    call -- `find_recent_snapshot` checks the last `cache_max_weeks_old`
    ISO weeks, not just this one (2026-10-15, Part 1a: video/hashtag data
    doesn't go stale after 7 days, so a product that was enriched 2 weeks
    ago and is still on the shortlist shouldn't cost credits again).
    `resume_mode=True` (set by `--resume-week`, added 2026-10-15 after a
    real incident: this check used to look at in-memory candidate fields
    that `ingest_from_snapshots` never populates, so a resumed run re-spent
    ~45 credits re-fetching data that was already on disk) raises
    MissingSnapshotError instead of falling through to a live call when no
    snapshot exists -- resume mode must make ZERO paid calls, full stop; a
    missing snapshot is a hard failure to surface and fix, not something to
    silently buy again."""
    today = today or date.today()
    fetched = 0
    for rank, cand in enumerate(shortlist):
        if rank < trend_tier_size and cand.get("daily_units_14") is None:
            trend_raw = find_recent_snapshot(f"trend_{cand['product_id']}", today, cache_max_weeks_old)
            if trend_raw is not None:
                _apply_trend(cand, trend_raw)
            elif resume_mode:
                raise MissingSnapshotError(
                    f"no cached trend snapshot for product {cand['product_id']} -- "
                    f"--resume-week makes zero paid calls, so this run can't proceed"
                )
            elif not tracker.would_exceed(2):
                try:
                    trend_raw = await fetch_daily_trend(client, cand["product_id"])
                    save_raw_snapshot(week, f"trend_{cand['product_id']}", trend_raw)
                    _apply_trend(cand, trend_raw)
                except FastMossError:
                    pass
                balance = await check_balance(client)
                tracker.checkpoint("trend", balance, note=f"product {rank + 1}/{len(shortlist)}")
            _apply_lead_signal(cand, today)

        if cand.get("videos") is not None:
            fetched += 1
            continue
        video_raw = find_recent_snapshot(f"videos_{cand['product_id']}", today, cache_max_weeks_old)
        if video_raw is not None:
            _apply_videos(cand, video_raw)
            fetched += 1
            continue
        if resume_mode:
            raise MissingSnapshotError(
                f"no cached video snapshot for product {cand['product_id']} -- "
                f"--resume-week makes zero paid calls, so this run can't proceed"
            )
        if tracker.would_exceed(1):
            break  # shortlist is score order -- once we can't afford this, we can't afford the rest either
        try:
            video_raw = await fetch_product_videos(client, cand["product_id"])
            save_raw_snapshot(week, f"videos_{cand['product_id']}", video_raw)
            _apply_videos(cand, video_raw)
        except FastMossError:
            pass
        fetched += 1
        balance = await check_balance(client)
        tracker.checkpoint("videos", balance, note=f"candidate {fetched}/{len(shortlist)}")


def _apply_trend(cand: dict, trend_raw: dict) -> None:
    days = trend_raw.get("daily_trend", [])
    cand["daily_units_14"] = [d["daily_units_sold"] for d in days[-14:]] if len(days) >= 14 else None
    summary = trend_period_summary(trend_raw)
    cand["creator_count"] = summary.get("linked_creator_count")
    cand["video_count"] = summary.get("linked_video_count")


def _apply_lead_signal(cand: dict, today: date) -> None:
    """Momentum's "lead" term (spec 6.2, 30% of momentum) was never
    populated -- lead_signal was never set anywhere in this module, so
    z_lead was always 0 for every candidate. Computed here for free from
    two CONSECUTIVE weekly trend snapshots (both already paid for, no new
    FastMoss call): this week's creator_count/video_count (already on
    `cand` via _apply_trend) vs the same product's snapshot from exactly
    one ISO week earlier. Falls back to leaving lead_signal unset
    (score_pool's `has_lead` gate then treats it as neutral, same as any
    other missing-signal fallback already in this pipeline) when there's
    no prior-week snapshot -- a product's first week being tracked has
    nothing to compare against."""
    if cand.get("creator_count") is None or cand.get("video_count") is None:
        return
    prior_week = last_completed_week_value(today)
    prior_trend_raw = load_raw_snapshot(prior_week, f"trend_{cand['product_id']}")
    if prior_trend_raw is None:
        return
    prior_summary = trend_period_summary(prior_trend_raw)
    creator_count_prior7 = prior_summary.get("linked_creator_count")
    video_count_prior7 = prior_summary.get("linked_video_count")
    if creator_count_prior7 is None or video_count_prior7 is None:
        return
    cand["lead_signal"] = lead_raw(
        creator_count_last7=cand["creator_count"],
        creator_count_prior7=creator_count_prior7,
        video_count_last7=cand["video_count"],
        video_count_prior7=video_count_prior7,
    )


def _apply_videos(cand: dict, raw: dict) -> None:
    cards = rank_videos_by_sales(video_cards_from_product_video_list(raw))
    cand["videos"] = cards
    captions = [v["caption_text"] for v in cards]
    cand["spanish_share"] = spanish_share(captions)
    cand["spanish_video_count"] = len(captions)


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


def _lead_is_dominant_driver(row: pd.Series, momentum_weights: dict) -> bool:
    """True when the lead term's weighted contribution to momentum has the
    largest magnitude among momentum's weighted components -- used to pick
    the "new creators" reason sentence over the plain wow% one."""
    contributions = {
        "wow": momentum_weights["wow_weight"] * row["z_wow"],
        "lead": momentum_weights["lead_weight"] * row["z_lead"],
    }
    if row.get("has_daily"):
        contributions["slope14"] = momentum_weights["slope14_weight"] * row["z_slope14"]
        contributions["accel"] = momentum_weights["accel_weight"] * row["z_accel"]
    dominant = max(contributions, key=lambda k: abs(contributions[k]))
    return dominant == "lead"


def build_reasons(
    row: pd.Series,
    creator_avg_gpm: float | None = None,
    spanish_gap_reason_max_share: float = 0.3,
    exclude: frozenset[str] = frozenset(),
    momentum_weights: dict | None = None,
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
                # Lead (creator/video growth, spec 6.2) gets its own
                # sentence instead of the wow% one when it's the biggest
                # weighted contributor to momentum -- otherwise "sales
                # went up 0%" could show for a product whose real signal
                # is a wave of new creators just starting to sell it,
                # before that shows up in sales yet.
                if row.get("has_lead") and momentum_weights and _lead_is_dominant_driver(row, momentum_weights):
                    reasons_es.append(render_reason("lead", "es"))
                    reasons_en.append(render_reason("lead", "en"))
                else:
                    # Fixed 2026-10-16: the template used to always say
                    # "subieron"/"went up" even when wow was negative,
                    # literally rendering "sales went up -39%". pct is
                    # always the absolute value now; the template name
                    # picks the right verb for the real direction.
                    momentum_key = "momentum_up" if row["wow"] >= 0 else "momentum_down"
                    pct_abs = abs(row["wow"] * 100)
                    reasons_es.append(render_reason(momentum_key, "es", pct=pct_abs))
                    reasons_en.append(render_reason(momentum_key, "en", pct=pct_abs))
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
    rng: random.Random | None = None,
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
    sampled = thompson_sample_categories(beliefs, rng=rng)
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
    # "More clothing in Esta semana" (2026-10-16): caps Hogar at
    # max_hogar_picks across the FULL final list (core + explore +
    # evergreen), not just the core slots -- explore/evergreen aren't
    # restricted by group and could otherwise push Hogar back over budget
    # after enforce_group_minimums above only guarded the core slots. Since
    # every scanned category is either "fashion" or "home" (categories.yaml),
    # capping Hogar at max_hogar_picks also guarantees min_moda_picks whenever
    # the list reaches its full target size.
    if categories_cfg is not None:
        max_hogar = weights["picks"].get("max_hogar_picks")
        if max_hogar is not None:
            picks = enforce_group_maximum(
                picks,
                ranked,
                categories_cfg,
                predicate=lambda meta: meta.get("group") == "home",
                max_count=max_hogar,
                max_per_category=max_per_category,
                max_per_shop=max_per_shop,
                max_per_brand=max_per_brand,
                title_jaccard_threshold=title_jaccard_threshold,
            )
    return picks


def _video_card_dicts(videos: list[dict] | None, limit: int) -> list[dict]:
    # `videos` is already sorted by rank_videos_by_sales when it was set
    # (engine/run.py's two `cand["videos"] = ...` sites), so [:limit] here
    # keeps the top-N by sales, not by whatever order FastMoss returned.
    return [
        {
            "video_id": v["video_id"],
            "cover_url": v.get("cover_url") or "",
            "tiktok_url": v.get("tiktok_url") or "",
            "creator_handle": v.get("creator_handle") or "",
            "play_count": v.get("play_count", 0),
            "window_gmv": v.get("window_gmv", 0.0),
            "window_units_sold": v.get("window_units_sold", 0),
            "is_ad": v.get("is_ad", False),
            "duration_seconds": v.get("duration_seconds"),
        }
        for v in (videos or [])[:limit]
    ]


def _saturation_dict(
    daily_units_14: list | None, creator_count: int | None, units_7d: float, saturation_cfg: dict | None
) -> dict | None:
    """None when saturation_cfg wasn't supplied (e.g. older call sites/tests
    that don't care about it), same as a product with no trend data."""
    if not saturation_cfg:
        return None
    return saturation_badge(
        daily_units_14,
        creator_count,
        units_7d,
        creators_per_100_units_entra_ya_max=saturation_cfg["creators_per_100_units_entra_ya_max"],
        creators_per_100_units_muy_lleno_min=saturation_cfg["creators_per_100_units_muy_lleno_min"],
        units_slope_growing_min=saturation_cfg["units_slope_growing_min"],
    )


def _pocas_latinas(spanish_share: float | None, units_7d: float, pocas_latinas_cfg: dict | None) -> bool:
    """False (not None) when pocas_latinas_cfg wasn't supplied -- same as
    engine.creator_gap.pocas_creadoras_latinas's own missing-input default."""
    if not pocas_latinas_cfg:
        return False
    return pocas_creadoras_latinas(
        spanish_share,
        units_7d,
        spanish_share_max=pocas_latinas_cfg["spanish_share_max"],
        min_units_7d=pocas_latinas_cfg["min_units_7d"],
    )


def picks_to_export_dicts(
    picks: list[dict],
    creator_avg_gpm: float | None = None,
    spanish_gap_reason_max_share: float = 0.3,
    creator_sweet_spot_seconds: tuple[int, int] = (13, 30),
    categories_cfg: dict | None = None,
    saturation_cfg: dict | None = None,
    pocas_latinas_cfg: dict | None = None,
    video_time_lookup: dict[str, dict | None] | None = None,
    momentum_weights: dict | None = None,
) -> list[dict]:
    out = []
    for p in picks:
        row = pd.Series(p)
        reasons_es, reasons_en = build_reasons(row, creator_avg_gpm, spanish_gap_reason_max_share, momentum_weights=momentum_weights)
        # The simplified card (added 2026-10-16) shows ONE plain sentence
        # instead of a bullet list, combining the non-earnings reasons --
        # earnings is already the card's own headline ("Ganas $X por venta").
        summary_reasons_es, summary_reasons_en = build_reasons(
            row, creator_avg_gpm, spanish_gap_reason_max_share, exclude=frozenset({"earnings"}), momentum_weights=momentum_weights
        )
        cat_meta = (categories_cfg or {}).get(p["config_category"], {})
        has_active_event = pd.notna(p.get("days_to_event_end")) and p.get("days_to_event_end", -1) >= 0
        out.append(
            {
                "slot": p["slot"],
                "kind": p["kind"],
                "product_id": p["product_id"],
                "title": p["title"],
                "clean_title": clean_title(p["title"]),
                "image_url": p.get("image_url") or "",
                "category": p["config_category"],
                # Part F (added 2026-10-15): the split-view detail panel
                # needs the localized label without a per-product fetch.
                "category_label_es": cat_meta.get("label_es", p["config_category"]),
                "category_label_en": cat_meta.get("label_en", p["config_category"]),
                # Moda/Hogar/Todo filter on Esta semana (added 2026-10-16):
                # needs each pick's group without a per-category lookup.
                "group": cat_meta.get("group", "fashion"),
                # H3 (added 2026-10-15): earnings/hour on the product page
                # comes from pairing this with earnings_per_sale client-side.
                "effort_minutes": cat_meta.get("effort_minutes"),
                "shop_name": p["shop_name"],
                "price": p["price"],
                "commission_rate": p["commission_rate"],
                "earnings_per_sale": round(p["earnings_per_sale"], 2),
                "stage": p["stage"],
                "score": int(p["score"]),
                "ev_typical": round(p["ev_typical"], 2),
                "ev_upside": round(p["ev_upside"], 2),
                # Part C card redesign (added 2026-10-16): the new compact
                # card ("units sold + % vs prior week + sparkline",
                # "~N sales/creator") needs these on Pick, not just
                # Candidate -- they were already computed (score_pool's own
                # row), just never exported here.
                "units_7d": int(p["units_7d"]),
                "creator_count": int(p["creator_count"]) if pd.notna(p.get("creator_count")) else None,
                "daily_units_14": p.get("daily_units_14") if isinstance(p.get("daily_units_14"), list) else [],
                # Card redesign's season-event tag -- matched_event_label was
                # already computed for the seasonality reason sentence but
                # never exported on its own before.
                "season_event_label_es": p.get("matched_event_label_es") if has_active_event else None,
                "season_event_label_en": p.get("matched_event_label_en") if has_active_event else None,
                "reasons_es": reasons_es,
                "reasons_en": reasons_en,
                "summary_es": join_reasons_as_sentence(summary_reasons_es, "es"),
                "summary_en": join_reasons_as_sentence(summary_reasons_en, "en"),
                "videos": _video_card_dicts(p.get("videos"), limit=3),
                "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=p["product_id"]),
                "tiktok_search_url": tiktok_search_url(clean_title(p["title"])),
                "tiktok_shop_url": tiktok_shop_url(p["product_id"]),
                # Part C (added 2026-10-15): the Hoy tab needs each pick's
                # hashtags/best hook without an extra per-product fetch.
                # Computed from the full video list, not the 3-card limit
                # above, for the best hashtag-weighting accuracy.
                "formula_ganadora": (
                    formula_ganadora_dict(p["videos"], creator_sweet_spot_seconds) if p.get("videos") else None
                ),
                "saturation_badge": _saturation_dict(
                    p.get("daily_units_14") if isinstance(p.get("daily_units_14"), list) else None,
                    int(p["creator_count"]) if pd.notna(p.get("creator_count")) else None,
                    p.get("units_7d", 0),
                    saturation_cfg,
                ),
                "spanish_share": p.get("spanish_share") if pd.notna(p.get("spanish_share")) else None,
                "pocas_creadoras_latinas": _pocas_latinas(
                    p.get("spanish_share") if pd.notna(p.get("spanish_share")) else None,
                    p.get("units_7d", 0),
                    pocas_latinas_cfg,
                ),
                "best_video_time": (video_time_lookup or {}).get(p["product_id"]),
            }
        )
    return out


def product_detail_dict(
    cand: dict,
    categories_cfg: dict,
    is_pick: bool,
    has_enrichment: bool,
    creator_sweet_spot_seconds: tuple[int, int] = (13, 30),
    saturation_cfg: dict | None = None,
    pocas_latinas_cfg: dict | None = None,
    video_time_lookup: dict[str, dict | None] | None = None,
) -> dict:
    """Full product-page detail (redesigned 2026-10-18 for the "Todos" full
    list: written for every clean candidate, not just the ~9 final picks,
    since any row there links to its own product page). Stat boxes (sold
    this week, total sales, commission, earnings, creators, videos) show for
    every product; `has_enrichment` (the top-15 by preliminary score that
    got trend + product_video_list) gates the 14-day chart, the embedded
    video gallery, and the "Formula Ganadora" box (Part B, added
    2026-10-15), which only exist for those."""
    cat_meta = categories_cfg.get(cand["config_category"], {})
    title = cand["title"]
    clean = clean_title(title)
    daily_units_14 = cand.get("daily_units_14") if isinstance(cand.get("daily_units_14"), list) else []
    # Videos/hashtags/formula_ganadora are gated on the product actually
    # HAVING videos, independent of `has_enrichment` (which means "has
    # trend data" everywhere else this flag is used, e.g. outreach.ts) --
    # Part C1's video backfill (2026-10-16) deliberately fetches videos for
    # far more products than ever get the trend call, so a backfilled
    # product with videos but no trend must still show its videos.
    videos = cand.get("videos") or []
    has_videos = bool(videos)
    creator_count = cand.get("creator_count") if has_enrichment else None
    return {
        "product_id": cand["product_id"],
        "title": title,
        "clean_title": clean,
        "image_url": cand.get("image_url") or "",
        "category": cand["config_category"],
        "category_label_es": cat_meta.get("label_es", cand["config_category"]),
        "category_label_en": cat_meta.get("label_en", cand["config_category"]),
        "effort_minutes": cat_meta.get("effort_minutes"),
        "shop_name": cand["shop_name"],
        "price": cand["price"],
        "commission_rate": cand["commission_rate"],
        "earnings_per_sale": round(earnings_per_sale(cand["price"], cand["commission_rate"]), 2),
        "units_7d": cand.get("units_7d", 0),
        "units_total": cand.get("units_total", 0),
        "creator_count": creator_count,
        "video_count": cand.get("video_count") if has_enrichment else None,
        "daily_units_14": daily_units_14 if has_enrichment else [],
        "is_pick": is_pick,
        "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=cand["product_id"]),
        "tiktok_search_url": tiktok_search_url(clean),
        "tiktok_shop_url": tiktok_shop_url(cand["product_id"]),
        "videos": _video_card_dicts(videos, limit=6) if has_videos else [],
        "formula_ganadora": formula_ganadora_dict(videos, creator_sweet_spot_seconds) if has_videos else None,
        "saturation_badge": (
            _saturation_dict(daily_units_14, creator_count, cand.get("units_7d", 0), saturation_cfg)
            if has_enrichment
            else None
        ),
        "spanish_share": cand.get("spanish_share"),
        "pocas_creadoras_latinas": _pocas_latinas(cand.get("spanish_share"), cand.get("units_7d", 0), pocas_latinas_cfg),
        "best_video_time": (video_time_lookup or {}).get(cand["product_id"]),
    }


def compute_best_video_times(
    pool: list[dict],
    categories_cfg: dict,
    today: date | None = None,
    snapshots_dir: Path = SNAPSHOTS_DIR,
) -> dict[str, dict | None]:
    """Part C7a: free (0-credit) best-time-to-post, computed from every
    video we've ever saved to disk -- recomputed every run as more videos
    accumulate, independent of which products got enriched THIS run (a
    product's own videos from 3 weeks ago still count). Returns
    product_id -> best_video_time() result (or None), for every candidate
    in `pool`; callers attach it to each export dict as "best_video_time"."""
    today = today or date.today()
    records = load_video_records(snapshots_dir)
    product_id_to_category = {c["product_id"]: c["config_category"] for c in pool}
    product_id_to_group = {
        c["product_id"]: categories_cfg.get(c["config_category"], {}).get("group", "fashion") for c in pool
    }
    return {
        c["product_id"]: best_video_time(
            c["product_id"],
            c["config_category"],
            product_id_to_group[c["product_id"]],
            records,
            product_id_to_category,
            product_id_to_group,
        )
        for c in pool
    }


def compute_best_times_by_category_and_group(
    pool: list[dict],
    categories_cfg: dict,
    snapshots_dir: Path = SNAPSHOTS_DIR,
) -> tuple[dict[str, dict | None], dict[str, dict | None]]:
    """Part C7c's Mas -> "Mejores horas" page: one best-time summary per
    category and per group (fashion/home), computed the same way
    compute_best_video_times computes per-product ones, just without that
    function's product -> category -> group -> all fallback ladder (the
    page wants to see category/group numbers even when a category itself
    is thin, not have them silently fall through to "all")."""
    records = load_video_records(snapshots_dir)
    product_id_to_category = {c["product_id"]: c["config_category"] for c in pool}
    product_id_to_group = {
        c["product_id"]: categories_cfg.get(c["config_category"], {}).get("group", "fashion") for c in pool
    }
    categories = {
        cat: best_time_for_pool([r for r in records if product_id_to_category.get(r["product_id"]) == cat]) for cat in categories_cfg
    }
    groups = {
        group: best_time_for_pool([r for r in records if product_id_to_group.get(r["product_id"]) == group])
        for group in {categories_cfg.get(c, {}).get("group", "fashion") for c in categories_cfg}
    }
    return categories, groups


# Part B Horarios rebuild (2026-10-16): "one card per real group, not 12
# duplicates" -- the 12 scanned categories collapse to the 5 groups Roxie
# actually schedules lives around. Deliberately finer than CategoryGroup's
# fashion/home split (Zapatos and Mascotas get their own group rather than
# folding into Moda/Hogar) and deliberately NOT config-driven: these 5 are
# a fixed, small, stable grouping of the category list above, not
# something that needs per-category YAML tuning the way scoring weights do.
SCHEDULE_GROUPS: dict[str, list[str]] = {
    "moda": ["shapewear", "dresses", "sets", "winter_clothing", "costumes", "pajamas", "activewear"],
    "zapatos": ["shoes"],
    "muebles": ["furniture"],
    "hogar": ["home_decor", "home_storage"],
    "mascotas": ["pet_furniture"],
}


def compute_live_schedule_by_group(
    live_timing_cfg: dict,
    snapshots_dir: Path = SNAPSHOTS_DIR,
) -> dict[str, dict]:
    """One result per SCHEDULE_GROUPS key: the best live window (reusing
    best_live_time_for_l1's median-ranked logic) plus a full day x 2-hour
    heat grid (heat_grid_cells) pooled across every L1 id that group's
    member categories map to -- several categories can share one L1 id
    (e.g. every Moda-core category reuses L1=2), so this dedupes by
    room_id across them before computing anything, the same way a single
    category's own best-time already dedupes across snapshot pages."""
    category_to_l1 = live_timing_cfg["category_to_l1_id"]
    result: dict[str, dict] = {}
    for group_key, member_categories in SCHEDULE_GROUPS.items():
        l1_ids = {category_to_l1[c] for c in member_categories if c in category_to_l1}
        records: list[dict] = []
        seen_room_ids: set[str] = set()
        for l1_id in l1_ids:
            for r in load_live_records(snapshots_dir, l1_id):
                if r["room_id"] in seen_room_ids:
                    continue
                seen_room_ids.add(r["room_id"])
                records.append(r)
        result[group_key] = {
            "best": best_live_time_for_l1(records),
            "grid": heat_grid_cells(records),
            "sample_size": len(records),
        }
    return result


def compute_live_times_by_category(
    live_timing_cfg: dict,
    categories_cfg: dict,
    snapshots_dir: Path = SNAPSHOTS_DIR,
) -> dict[str, dict | None]:
    """Part C7b's live-time breakdown, one result per OUR category key
    (not per L1 id) -- several categories share an L1 id's live data (e.g.
    every Womenswear & Underwear category reuses the same L1=2 pull), so
    this fetches load_live_records once per distinct L1 id and reuses the
    result for every category mapped to it."""
    category_to_l1 = live_timing_cfg["category_to_l1_id"]
    by_l1_id: dict[int, dict | None] = {}
    for l1_id in set(category_to_l1.values()):
        records = load_live_records(snapshots_dir, l1_id)
        by_l1_id[l1_id] = best_live_time_for_l1(records)
    return {cat: by_l1_id.get(category_to_l1[cat]) for cat in categories_cfg if cat in category_to_l1}


def compute_live_highlights_by_category(
    live_timing_cfg: dict,
    categories_cfg: dict,
    today: date,
    snapshots_dir: Path = SNAPSHOTS_DIR,
    within_days: int = 28,
    limit: int = 10,
) -> dict[str, list[dict]]:
    """Part 7 "En vivo" (2026-10-16): the "top-selling lives in her
    categories last 28 days" list, one result per OUR category key -- same
    L1-id sharing/reuse as compute_live_times_by_category above, just
    using top_lives_for_l1 (keeps title/viewer_count/duration) instead of
    best_live_time_for_l1 (keeps only the best-time ranking fields)."""
    category_to_l1 = live_timing_cfg["category_to_l1_id"]
    now = datetime.combine(today, datetime.min.time(), tzinfo=UTC)
    by_l1_id: dict[int, list[dict]] = {}
    for l1_id in set(category_to_l1.values()):
        by_l1_id[l1_id] = top_lives_for_l1(snapshots_dir, l1_id, now, within_days=within_days, limit=limit)
    return {cat: by_l1_id.get(category_to_l1[cat], []) for cat in categories_cfg if cat in category_to_l1}


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
    df: pd.DataFrame,
    categories_cfg: dict,
    pick_ids: set[str],
    flagged: list[dict] | None = None,
    saturation_cfg: dict | None = None,
    pocas_latinas_cfg: dict | None = None,
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
                "effort_minutes": cat_meta.get("effort_minutes"),
                "group": cat_meta.get("group", "fashion"),
                "shop_name": r["shop_name"],
                "stage": r["stage"],
                "rank": int(r["rank"]),
                "price": r["price"],
                "commission_rate": r["commission_rate"],
                "earnings_per_sale": round(r["earnings_per_sale"], 2),
                "units_7d": int(r["units_7d"]),
                "units_total": int(r["units_total"]),
                "creator_count": int(r["creator_count"]) if pd.notna(r.get("creator_count")) else None,
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
                # Part C "midweek refresh" (added 2026-10-16): only
                # engine.midweek_refresh ever sets this True (Thursday's
                # Monday-vs-now rank comparison); the regular Monday run
                # has no "before" rank to compare against, so it's always
                # False here.
                "rising_fast": False,
                "season_event_label_es": (
                    r.get("matched_event_label_es")
                    if pd.notna(r.get("days_to_event_end")) and r.get("days_to_event_end", -1) >= 0
                    else None
                ),
                "season_event_label_en": (
                    r.get("matched_event_label_en")
                    if pd.notna(r.get("days_to_event_end")) and r.get("days_to_event_end", -1) >= 0
                    else None
                ),
                "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=r["product_id"]),
                "tiktok_search_url": tiktok_search_url(clean),
                "tiktok_shop_url": tiktok_shop_url(r["product_id"]),
                "saturation_badge": _saturation_dict(
                    r["daily_units_14"] if isinstance(r["daily_units_14"], list) else None,
                    int(r["creator_count"]) if pd.notna(r.get("creator_count")) else None,
                    r.get("units_7d", 0),
                    saturation_cfg,
                ),
                "spanish_share": r.get("spanish_share") if pd.notna(r.get("spanish_share")) else None,
                "pocas_creadoras_latinas": _pocas_latinas(
                    r.get("spanish_share") if pd.notna(r.get("spanish_share")) else None,
                    r.get("units_7d", 0),
                    pocas_latinas_cfg,
                ),
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
                "effort_minutes": cat_meta.get("effort_minutes"),
                "group": cat_meta.get("group", "fashion"),
                "shop_name": c["shop_name"],
                "stage": None,
                "rank": c.get("rank", 0),
                "price": c["price"],
                "commission_rate": c["commission_rate"],
                "earnings_per_sale": round(earnings_per_sale(c["price"], c["commission_rate"]), 2),
                "units_7d": c.get("units_7d", 0),
                "units_total": c.get("units_total", 0),
                "creator_count": None,
                "score": None,
                "ev_typical": None,
                "daily_units": [],
                "is_pick": False,
                "has_enrichment": False,
                "suspicious": True,
                "suspicious_reasons": c["suspicious_reasons"],
                "rising_fast": False,
                "season_event_label_es": None,
                "season_event_label_en": None,
                "fastmoss_url": FASTMOSS_PRODUCT_URL_TEMPLATE.format(product_id=c["product_id"]),
                "tiktok_search_url": tiktok_search_url(clean),
                "tiktok_shop_url": tiktok_shop_url(c["product_id"]),
                "saturation_badge": None,
                "spanish_share": None,
                "pocas_creadoras_latinas": False,
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

    # Opened here, not at the end, so BudgetTracker can write each ledger
    # row AS IT'S SPENT (added 2026-10-15) -- a run that crashes mid-way no
    # longer loses its own credit record. None for --dry-run: no real
    # credits, nothing to log.
    conn = None if args.dry_run else connect(REPO_ROOT / "data" / "radar.db")

    df = pd.DataFrame()
    flagged: list[dict] = []
    async with client_cm as client:
        starting_balance = await check_balance(client)

        credits_cfg = config["weights"]["credits"]
        if args.budget is not None:
            effective_budget = args.budget
            print(f"--budget {args.budget} passed explicitly -- skipping the dynamic budget calculation.")
        else:
            reset_date = date.fromisoformat(credits_cfg["reset_date"])
            budget_calc = dynamic_weekly_budget(
                starting_balance,
                today,
                reset_date,
                safety_floor_credits=credits_cfg["safety_floor_credits"],
            )
            effective_budget = min(budget_calc["budget_per_run"], credits_cfg["hard_cap_per_run"])
            print(
                "Dynamic budget: balance={balance} - safety_floor_credits={safety_floor_credits} = "
                "{available_for_weekly_runs} available / {mondays_left} Mondays left = {budget_per_run}/run "
                f"(capped at hard_cap_per_run={credits_cfg['hard_cap_per_run']} -> using {effective_budget})".format(
                    **budget_calc
                )
            )

        tracker = BudgetTracker(hard_cap=effective_budget, starting_balance=starting_balance, run_id=run_id, conn=conn)

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
            # Off-category filter (added 2026-10-16): a hard drop, unlike
            # the suspicious-listing filter below -- these aren't flagged
            # for review, they're simply the wrong kind of product for
            # their category (stickers under "home decor", etc.), per
            # config/categories.yaml's exclude_title_keywords/require_
            # title_keywords.
            pool, off_category_dropped = filter_off_category(pool, config["categories"]["categories"])
            for d in off_category_dropped:
                print(f"Dropped off-category: {d['title']!r} ({d['config_category']}) -- {d['drop_reason']}")
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
                enrichment_cfg = config["weights"].get("enrichment", {})
                video_tier_size = enrichment_cfg.get("video_tier_size", SHORTLIST_SIZE)
                trend_tier_size = enrichment_cfg.get("trend_tier_size", SHORTLIST_SIZE)
                cache_max_weeks_old = enrichment_cfg.get("video_cache_max_weeks", 4)
                # Preserves score order (pool's own order doesn't match df's
                # sort) -- enrich_shortlist's trend/video tiering depends on
                # `shortlist`'s position, not just set membership.
                ranked_ids = list(df.sort_values("score", ascending=False).head(video_tier_size)["product_id"])
                pool_by_id = {c["product_id"]: c for c in pool}
                shortlist = [pool_by_id[pid] for pid in ranked_ids if pid in pool_by_id]
                await enrich_shortlist(
                    client,
                    shortlist,
                    week,
                    tracker,
                    resume_mode=bool(args.resume_week),
                    trend_tier_size=trend_tier_size,
                    cache_max_weeks_old=cache_max_weeks_old,
                    today=today,
                )
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
    sweet_spot = tuple(weights["formula_ganadora"]["creator_sweet_spot_seconds"])
    saturation_cfg = weights["saturation_badge"]
    pocas_latinas_cfg = weights["pocas_latinas"]
    pick_ids = {p["product_id"] for p in picks}
    video_time_lookup = compute_best_video_times(pool + flagged, categories_cfg, today)
    pick_dicts = picks_to_export_dicts(
        picks,
        creator_avg_gpm,
        spanish_gap_reason_max_share,
        sweet_spot,
        categories_cfg,
        saturation_cfg,
        pocas_latinas_cfg,
        video_time_lookup,
        weights["momentum"],
    )
    candidate_dicts = candidates_to_export_dicts(df, categories_cfg, pick_ids, flagged, saturation_cfg, pocas_latinas_cfg)

    # `--export-dir` writes the data-export files even on a --dry-run (to a
    # caller-chosen directory, never web/public/data) so the export path
    # itself -- not just the individual dict-builder functions -- can be
    # proven to write every field at zero credits (see tests/test_export_
    # completeness.py). meta.json and the credit ledger stay gated on a real
    # (non-dry) run below: they're meaningless for a fixture replay.
    export_dir = Path(args.export_dir) if args.export_dir else None
    if not args.dry_run or export_dir is not None:
        export.write_picks(week, CREATOR, pick_dicts, data_dir=export_dir)
        export.write_candidates(week, candidate_dicts, data_dir=export_dir)
        export.write_hooks(config["hooks"], data_dir=export_dir)
        best_times_by_category, best_times_by_group = compute_best_times_by_category_and_group(pool + flagged, categories_cfg)
        live_timing_cfg = config["weights"].get("live_timing")
        live_times_by_category = compute_live_times_by_category(live_timing_cfg, categories_cfg) if live_timing_cfg else {}
        export.write_best_times(best_times_by_category, best_times_by_group, live_times_by_category, data_dir=export_dir)
        live_highlights_by_category = (
            compute_live_highlights_by_category(live_timing_cfg, categories_cfg, today) if live_timing_cfg else {}
        )
        export.write_live_highlights(live_highlights_by_category, data_dir=export_dir)
        live_schedule_by_group = compute_live_schedule_by_group(live_timing_cfg) if live_timing_cfg else {}
        export.write_live_schedule(live_schedule_by_group, data_dir=export_dir)
        # Every clean + suspicious candidate gets its own product page (not
        # just the ~9 picks) -- the "Todos" full list links to any of them.
        enriched_ids = {c["product_id"] for c in pool if isinstance(c.get("daily_units_14"), list)}
        for cand in pool:
            export.write_product(
                cand["product_id"],
                product_detail_dict(
                    cand,
                    categories_cfg,
                    cand["product_id"] in pick_ids,
                    cand["product_id"] in enriched_ids,
                    sweet_spot,
                    saturation_cfg,
                    pocas_latinas_cfg,
                    video_time_lookup,
                ),
                data_dir=export_dir,
            )
        for cand in flagged:
            export.write_product(
                cand["product_id"],
                product_detail_dict(
                    cand, categories_cfg, False, False, sweet_spot, saturation_cfg, pocas_latinas_cfg, video_time_lookup
                ),
                data_dir=export_dir,
            )
    if not args.dry_run:
        # Ledger rows for this run were already written as each one happened
        # (BudgetTracker.checkpoint, via the `conn` passed in above) -- no
        # batch write needed here any more.
        export.write_meta(
            week=week,
            run_id=run_id,
            credits_used_this_run=tracker.spent,
            credits_used_this_week=credits_used_for_week(conn, week),
            credits_used_month=500 - final_balance,
            credits_balance=final_balance,
            avg_credits_per_run=average_credits_per_run(conn),
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

    if not args.dry_run:
        # Part C8: pulls Roxie's Mis Productos earnings (what she
        # requested/received/filmed/posted and actually earned) into
        # data/radar.db -- zero FastMoss credits (one HTTP GET to our own
        # Worker, not an MCP call). Skipped entirely, not a hard failure,
        # when the secret isn't set (e.g. local runs) or the fetch fails
        # (e.g. the Worker is briefly down) -- this is outcome-data
        # collection, not core to the pipeline's own picks/export.
        mis_productos_token = os.environ.get("MIS_PRODUCTOS_TOKEN")
        if mis_productos_token:
            try:
                synced = sync_mis_productos_earnings(conn, mis_productos_token)
                print(f"Synced {synced} Mis Productos row(s) into mis_productos_earnings.")
            except EarningsFetchError as e:
                print(f"Mis Productos sync skipped: {e}")

    if flagged:
        print(f"\nExcluded {len(flagged)} suspicious listing(s):")
        for c in flagged:
            print(f"  - {c['title'][:60]} ({c['shop_name']}): {'; '.join(c['suspicious_reasons'])}")

    if args.print_picks or args.dry_run:
        print_picks(pick_dicts)
    print(f"\nCredits this run: {tracker.spent} (cap {effective_budget}). Balance: {final_balance}/500.")


def main() -> None:
    load_dotenv(REPO_ROOT / ".env")  # local dev only -- CI sets FASTMOSS_API_KEY directly, no .env file there
    parser = argparse.ArgumentParser(description="Product Radar weekly pipeline")
    parser.add_argument("--dry-run", action="store_true", help="replay fixtures, zero credits")
    parser.add_argument("--week", default=None, help="ISO week label, e.g. 2026-W43 (default: current)")
    parser.add_argument("--print-picks", action="store_true", help="print the Top 10 to stdout")
    parser.add_argument(
        "--budget",
        type=int,
        default=None,
        help="hard credit cap for this run; omit to compute it dynamically (see engine.budget.dynamic_weekly_budget)",
    )
    parser.add_argument(
        "--resume-week",
        default=None,
        help="rebuild from data/snapshots/<week>/ instead of re-ingesting (still does spanish-gap for real)",
    )
    parser.add_argument(
        "--export-dir",
        default=None,
        help=(
            "write this run's picks/candidates/hooks/product JSON here (meta.json and the credit "
            "ledger are untouched). Combine with --dry-run to prove the export path writes every "
            "field the site needs, at zero credits, without touching web/public/data."
        ),
    )
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
