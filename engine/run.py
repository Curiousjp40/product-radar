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
import uuid
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from engine import export
from engine.budget import BudgetExceeded, BudgetTracker, append_credit_log, check_balance, write_ledger_row
from engine.client import FastMossClient, FastMossError, FixtureReplayClient
from engine.config import load_all
from engine.db import connect
from engine.features import acceleration, demand, lead_raw, momentum, momentum_multiplier, slope_log1p, wow
from engine.fit import (
    audience_fit,
    blended_price_fit,
    category_prior_raw,
    demographic_fit_heuristic,
    fit_score,
    normalize_priors,
    target_category_boost,
)
from engine.ingest import (
    fetch_daily_trend,
    fetch_overview,
    fetch_top_selling,
    fetch_video_search_captions,
    resolve_category_ids,
    save_raw_snapshot,
)
from engine.insights import summarize_creator
from engine.language import spanish_share
from engine.normalize import ads_share_pct_from_overview, lead_counts_from_overview, normalize_rank_row, trend_period_summary
from engine.picks import (
    build_top10,
    compute_blended_ranks,
    filter_diverse_topn,
    pick_explore_categories,
    render_reason,
    select_top_reasons,
    thompson_sample_categories,
)
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
from engine.seasonality import event_term, personal_term, seasonality_score
from engine.seed import load_creator_history, shop_videos_only
from engine.stages import classify_stage
from engine.stats import grouped_robust_z
from engine.timeutil import now_eastern

REPO_ROOT = Path(__file__).resolve().parent.parent
CREATOR = "roxm___"

# Dry-run only has Phase 0's real fixtures for one category (shapewear) -- it
# proves the pipeline wiring works end to end on real-shaped data at zero
# credits, not a realistic multi-category simulation. The real run spans the
# full target-category list below.
REAL_CATEGORY_QUERIES = {
    "shapewear": "shapewear",
    "womens_clothing": "women's clothing",
    "home_decor": "home decor",
    "beauty_hair": "beauty",
}
DRY_RUN_CATEGORY_QUERIES = {"shapewear": "shapewear"}

DRY_RUN_FIXTURES = {
    "credit_usage_summary": "fastmoss_credit_usage_summary.json",
    "search_category_by_words": "fastmoss_search_category_by_words.json",
    "product_rank_top_selling": "fastmoss_product_rank_top_selling.json",
    "product_sales_trend": "fastmoss_product_sales_trend.json",
    "product_overview": "fastmoss_product_overview.json",
    "video_search": "fastmoss_video_search.json",
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


async def ingest(client, config: dict, week: str, date_value: str, tracker: BudgetTracker, is_dry_run: bool) -> list[dict]:
    queries = DRY_RUN_CATEGORY_QUERIES if is_dry_run else REAL_CATEGORY_QUERIES
    categories = await resolve_category_ids(client, queries)
    balance = await check_balance(client)
    tracker.checkpoint("category_resolution", balance)

    def maybe_save_snapshot(name: str, payload: dict) -> str | None:
        # Dry-run replays the same fixture for every call -- saving it as a
        # "snapshot" would just be redundant copies of tests/fixtures/ content.
        return None if is_dry_run else save_raw_snapshot(week, name, payload)

    candidates: list[dict] = []
    for key, cat in categories.items():
        # L2 is a reasonable middle ground: L3 was too narrow for broad terms
        # like "home decor" in Phase 0 testing (best match was a religious-decor
        # subcategory), L1 too broad (mixes in unrelated subcategories).
        category_id = cat.get("category_id_level2") or cat.get("category_id_level3") or cat.get("category_id_level1")
        raw = await fetch_top_selling(client, category_id, week=week, date_value=date_value)
        raw_ref = maybe_save_snapshot(f"top_selling_{key}", raw)
        for i, row in enumerate(raw.get("list", []), start=1):
            product, snapshot = normalize_rank_row(row, week=week, rank=i, raw_ref=raw_ref)
            candidates.append(
                {
                    "product_id": product.product_id,
                    "config_category": key,
                    "category_l1": product.category_l1,
                    "category_l2": product.category_l2,
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
                    "spanish_share": None,
                }
            )
        balance = await check_balance(client)
        tracker.checkpoint("rankings", balance, note=f"category {key}")
    candidates = [c for c in candidates if not c["delisted"]]

    # Pool: top ~12 by GMV across all categories get deeper (trend) analysis.
    pool = sorted(candidates, key=lambda c: c["gmv_7d"], reverse=True)[:12]

    # Balance is checked after EVERY call in these loops (free) rather than
    # once per stage, so `would_exceed` reflects what's actually been spent
    # so far in the loop, not a stale pre-loop total.
    trends_fetched = 0
    for cand in pool:
        if tracker.would_exceed(3):
            break
        try:
            trend_raw = await fetch_daily_trend(client, cand["product_id"])
            maybe_save_snapshot(f"trend_{cand['product_id']}", trend_raw)
            days = trend_raw.get("daily_trend", [])
            cand["daily_units_14"] = [d["daily_units_sold"] for d in days[-14:]] if len(days) >= 14 else None
            summary = trend_period_summary(trend_raw)
            cand["creator_count"] = summary.get("linked_creator_count")
            cand["video_count"] = summary.get("linked_video_count")
        except FastMossError:
            cand["daily_units_14"] = None
        trends_fetched += 1
        balance = await check_balance(client)
        tracker.checkpoint("trends", balance, note=f"product {trends_fetched}/{len(pool)}")

    # Overview (ads-share risk input + leading-indicator input): limited to
    # the top 6 pool candidates since this tool is the expensive (3-credit) tier.
    overview_pool = pool[:6]
    overviews_fetched = 0
    for cand in overview_pool:
        if tracker.would_exceed(3):
            break
        try:
            overview_raw = await fetch_overview(client, cand["product_id"])
            maybe_save_snapshot(f"overview_{cand['product_id']}", overview_raw)
            cand["ads_share_pct"] = ads_share_pct_from_overview(overview_raw)
            lead_counts = lead_counts_from_overview(overview_raw)
            if lead_counts:
                c7, p7, v7, vp7 = lead_counts
                cand["lead_signal"] = lead_raw(c7, p7, v7, vp7)
        except FastMossError:
            pass
        overviews_fetched += 1
        balance = await check_balance(client)
        tracker.checkpoint("overview", balance, note=f"product {overviews_fetched}/{len(overview_pool)}")

    return candidates


async def enrich_spanish_gap(client, shortlist: list[dict], week: str, tracker: BudgetTracker) -> None:
    """section 6.8: Spanish-gap video search, only for the preliminary top
    ~10 candidates (budget)."""
    now_ts = now_eastern().timestamp()
    fetched = 0
    for cand in shortlist:
        if tracker.would_exceed(1):
            break
        try:
            captions = await fetch_video_search_captions(
                client, cand["title"][:60], create_time_min=now_ts - 30 * 86400, create_time_max=now_ts
            )
            cand["spanish_share"] = spanish_share(captions)
            cand["spanish_video_count"] = len(captions)
        except FastMossError:
            pass
        fetched += 1
        balance = await check_balance(client)
        tracker.checkpoint("spanish_gap", balance, note=f"candidate {fetched}/{len(shortlist)}")


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
        "p90_views": float(np.percentile(views, 90)),
        "cvr_per_10k_views": summary["units_per_10k_views"],
        "by_month_category": by_month_category,
    }


def _category_priors(config: dict) -> dict[str, float]:
    creators_cfg = config["creators"][CREATOR]
    pooled = config["creators"]["pooled_category_gpm_per_1k_views"]
    weights_cfg = config["weights"]["fit"]
    raw = {
        cat: category_prior_raw(
            views_c=creators_cfg["category_views"].get(cat, 0),
            her_gpm_c=creators_cfg["category_gpm_per_1k_views"].get(cat, pooled.get(cat, 0)),
            pooled_gpm_c=pooled.get(cat, 0),
            k=weights_cfg["shrink_k_views"],
        )
        for cat in REAL_CATEGORY_QUERIES
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

        price_fit = blended_price_fit(
            price=c["price"],
            creator_log_mean=math.log(creators_cfg["price_fit_log_mean_usd"]),
            n_tracked_videos=creator_stats["n_tracked_videos"],
            sweet_spot_usd=tuple(config["categories"]["price_sweet_spot_usd"]),
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

        matching_events = [
            e
            for e in season_events
            if c["config_category"] in e.get("categories", []) and e.get("film_start") and e.get("film_end")
        ]
        event_val = max(
            (
                event_term(
                    today,
                    date.fromisoformat(e["film_start"]),
                    date.fromisoformat(e["film_end"]),
                    weights["seasonality"]["event_lookahead_days"],
                )
                for e in matching_events
            ),
            default=0.0,
        )
        month_gmv = creator_stats["by_month_category"].get(today.month, {})
        personal_val = personal_term(
            category_month_gmv=month_gmv.get(c["config_category"], 0.0),
            total_month_gmv=sum(month_gmv.values()),
            n_categories=max(len(month_gmv), 1),
        )
        season_weights = weights["seasonality"]["weights"]
        season_val = seasonality_score(event_val, personal_val, season_weights["event"], season_weights["personal"])

        is_new = creator_count is not None and creator_count < 5  # cold-start proxy, no category percentile yet
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
                "event_val": event_val,
                "personal_val": personal_val,
                "season_val": season_val,
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
        lambda r: spanish_gap(r["z_demand"], r["spanish_share"] if r["spanish_share"] is not None else 0.5), axis=1
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
    df["ev_upside"] = df.apply(lambda r: _row_ev(r, creator_stats["p90_views"]), axis=1)

    return df


def build_reasons(row: pd.Series) -> tuple[list[str], list[str]]:
    components = {
        "momentum": row["wow"],
        "earnings": row["earnings_per_sale"] - 1.5,  # magnitude relative to the "worth it" floor
        "spanish_gap": row["z_spanish_gap"],
        "seasonality": row["season_val"],
        "fit": row["z_fit"],
    }
    top = select_top_reasons(components, max_reasons=3)
    reasons_es, reasons_en = [], []
    for comp in top:
        try:
            if comp == "momentum":
                reasons_es.append(render_reason("momentum", "es", pct=row["wow"] * 100))
                reasons_en.append(render_reason("momentum", "en", pct=row["wow"] * 100))
            elif comp == "earnings":
                reasons_es.append(render_reason("earnings", "es", amount=row["earnings_per_sale"]))
                reasons_en.append(render_reason("earnings", "en", amount=row["earnings_per_sale"]))
            elif comp == "spanish_gap" and row.get("spanish_share") is not None:
                total = int(row.get("spanish_video_count") or 0)
                n_es = round((1 - row["spanish_share"]) * total)
                reasons_es.append(render_reason("spanish_gap", "es", n=n_es, total=total))
                reasons_en.append(render_reason("spanish_gap", "en", n=n_es, total=total))
            elif comp == "seasonality" and row["event_val"] > 0:
                reasons_es.append(f"Temporada activa para {row['config_category']}")
                reasons_en.append(f"Active season for {row['config_category']}")
            elif comp == "fit":
                reasons_es.append(render_reason("fit", "es"))
                reasons_en.append(render_reason("fit", "en"))
        except KeyError:
            continue
    return reasons_es, reasons_en


# ---------------------------------------------------------------------------
# Picks assembly
# ---------------------------------------------------------------------------


def assemble_picks(df: pd.DataFrame, weights: dict) -> list[dict]:
    if df.empty:
        return []
    records = df.to_dict("records")
    for r in records:
        r["category"] = r["config_category"]
    ranked = compute_blended_ranks(records)
    diverse = filter_diverse_topn(
        ranked,
        n=weights["picks"]["core_slots"] + weights["picks"]["explore_slots"] + weights["picks"]["evergreen_slots"],
        max_per_category=weights["picks"]["max_per_category"],
        max_per_shop=weights["picks"]["max_per_shop"],
        title_jaccard_threshold=weights["picks"]["title_jaccard_duplicate_threshold"],
    )

    categories = sorted(df["config_category"].unique())
    beliefs = {c: (1.0, 1.0) for c in categories}  # first run: no history, uniform Beta(1,1) prior
    sampled = thompson_sample_categories(beliefs)
    explore_cats = pick_explore_categories(sampled, trial_counts=dict.fromkeys(categories, 0), k=weights["picks"]["explore_slots"])
    used_ids = {c["product_id"] for c in diverse[: weights["picks"]["core_slots"]]}
    explore_candidates = [
        c for c in ranked if c["config_category"] in explore_cats and c["product_id"] not in used_ids
    ][: weights["picks"]["explore_slots"]]

    picks = build_top10(
        ranked_diverse_candidates=diverse,
        explore_candidates=explore_candidates,
        evergreen_candidate=None,  # first run: no outcome history for a "winner trending again"
        core_slots=weights["picks"]["core_slots"],
        explore_slots=weights["picks"]["explore_slots"],
        evergreen_slots=0,  # no evergreen candidate available yet this run
    )
    return picks


def picks_to_export_dicts(picks: list[dict]) -> list[dict]:
    out = []
    for p in picks:
        reasons_es, reasons_en = build_reasons(pd.Series(p))
        out.append(
            {
                "slot": p["slot"],
                "kind": p["kind"],
                "product_id": p["product_id"],
                "title": p["title"],
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
            }
        )
    return out


def candidates_to_export_dicts(df: pd.DataFrame) -> list[dict]:
    out = []
    for _, r in df.iterrows():
        out.append(
            {
                "product_id": r["product_id"],
                "title": r["title"],
                "category": r["config_category"],
                "shop_name": r["shop_name"],
                "stage": r["stage"],
                "price": r["price"],
                "commission_rate": r["commission_rate"],
                "score": int(r["score"]),
                "ev_typical": round(r["ev_typical"], 2),
                "daily_units": r["daily_units_14"] or [],
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
    week = args.week or iso_week_label(today)
    date_value = last_completed_week_value(today)
    run_id = f"{week}-{uuid.uuid4().hex[:8]}"

    client_cm = FixtureReplayClient(DRY_RUN_FIXTURES) if args.dry_run else FastMossClient()

    df = pd.DataFrame()
    async with client_cm as client:
        starting_balance = await check_balance(client)
        tracker = BudgetTracker(hard_cap=args.budget, starting_balance=starting_balance, run_id=run_id)

        try:
            pool = await ingest(client, config, week, date_value, tracker, args.dry_run)
            creator_stats = _creator_stats(config)
            df = score_pool(pool, config, creator_stats, today)

            if not df.empty:
                prelim_ids = set(df.sort_values("score", ascending=False).head(10)["product_id"])
                shortlist = [c for c in pool if c["product_id"] in prelim_ids]
                await enrich_spanish_gap(client, shortlist, week, tracker)
                # `shortlist` dicts are the same objects referenced in `pool` (shared,
                # not copied), so enrich_spanish_gap's mutation is already reflected
                # in `pool` -- just recompute scores from scratch with it filled in.
                df = score_pool(pool, config, creator_stats, today)
        except BudgetExceeded as e:
            print(f"BUDGET STOP: {e}")

        final_balance = await check_balance(client)

    weights = config["weights"]
    picks = assemble_picks(df, weights) if not df.empty else []
    pick_dicts = picks_to_export_dicts(picks)
    candidate_dicts = candidates_to_export_dicts(df) if not df.empty else []

    if not args.dry_run:
        export.write_picks(week, CREATOR, pick_dicts)
        export.write_candidates(week, candidate_dicts)
        export.write_meta(
            week=week,
            run_id=run_id,
            credits_used_this_run=tracker.spent,
            credits_used_month=500 - final_balance,
            credits_balance=final_balance,
        )
        conn = connect(REPO_ROOT / "data" / "radar.db")
        for stage in tracker.stage_log:
            write_ledger_row(conn, run_id, stage["stage"], stage["credits"], True, stage["note"])
        append_credit_log(
            run_id,
            today.isoformat(),
            tracker.spent,
            final_balance,
            f"Phase 1+2 real run: {len(pick_dicts)} picks from {len(df)} candidates. " + "; ".join(
                f"{s['stage']}={s['credits']}cr" for s in tracker.stage_log
            ),
        )

    if args.print_picks or args.dry_run:
        print_picks(pick_dicts)
    print(f"\nCredits this run: {tracker.spent} (cap {args.budget}). Balance: {final_balance}/500.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Product Radar weekly pipeline")
    parser.add_argument("--dry-run", action="store_true", help="replay fixtures, zero credits")
    parser.add_argument("--week", default=None, help="ISO week label, e.g. 2026-W43 (default: current)")
    parser.add_argument("--print-picks", action="store_true", help="print the Top 10 to stdout")
    parser.add_argument("--budget", type=int, default=80, help="hard credit cap for this run")
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
