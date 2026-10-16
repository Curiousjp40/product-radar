"""CLI: python -m engine.midweek_refresh [--dry-run]

Thursday "midweek refresh" (Ryan, 2026-10-16): re-pulls only the
top-selling rankings for every active category (no trend, no video --
those stay Monday-only), flags products that jumped 10+ places since
Monday as "rising fast", fetches a video for any brand-new top-10 entry
that doesn't already have one cached, and re-exports candidates.json +
product pages. Picks (picks.json) are NOT touched -- this is Todos/product-
page freshness, not a re-pick.

RISING_FAST_THRESHOLD places of improvement (lower rank number = better)
since Monday's own top_selling snapshot is what "rising fast" means.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import date

from dotenv import load_dotenv

from engine import export
from engine.budget import BudgetExceeded, BudgetTracker, check_balance
from engine.client import FastMossClient, FastMossError
from engine.config import load_all
from engine.db import connect
from engine.ingest import fetch_product_videos, fetch_top_selling, find_recent_snapshot, load_raw_snapshot, save_raw_snapshot
from engine.language import spanish_share
from engine.normalize import normalize_rank_row, rank_videos_by_sales, trend_period_summary, video_cards_from_product_video_list
from engine.run import (
    REPO_ROOT,
    _creator_stats,
    active_categories,
    candidates_to_export_dicts,
    iso_week_label,
    last_completed_week_value,
    partition_suspicious,
    product_detail_dict,
    score_pool,
)

RISING_FAST_THRESHOLD = 10
NEW_ENTRY_TOP_N = 10

MIDWEEK_SNAPSHOT_PREFIX = "midweek_top_selling"


def compute_old_ranks(week: str, category_meta: dict) -> dict[str, int]:
    """Monday's own top_selling_<key>_p<page>.json files -- NOT the
    midweek-prefixed ones -- give the rank each product_id held at the
    start of the week."""
    old_ranks: dict[str, int] = {}
    for key, meta in category_meta.items():
        if "fastmoss_category_id" not in meta:
            continue
        for page in range(1, meta["pages"] + 1):
            raw = load_raw_snapshot(week, f"top_selling_{key}_p{page}")
            if raw is None:
                continue
            for i, row in enumerate(raw.get("list", []), start=(page - 1) * 10 + 1):
                pid = row.get("product_id") or row.get("product", {}).get("product_id")
                if pid:
                    old_ranks[str(pid)] = i
    return old_ranks


def flag_rising_fast(candidates: list[dict], old_ranks: dict[str, int], threshold: int = RISING_FAST_THRESHOLD) -> None:
    """Mutates each candidate in place, adding 'rising_fast' and
    'is_new_entry'. A product absent from Monday's ranks is a new entry,
    never "rising fast" (there's no prior rank to have jumped from)."""
    for c in candidates:
        old_rank = old_ranks.get(c["product_id"])
        c["is_new_entry"] = old_rank is None
        c["rising_fast"] = old_rank is not None and (old_rank - c["rank"]) >= threshold


def estimate_credits(category_meta: dict) -> int:
    return sum(meta["pages"] for meta in category_meta.values() if "fastmoss_category_id" in meta)


async def midweek_refresh(dry_run: bool = True, today: date | None = None) -> dict:
    today = today or date.today()
    config = load_all()
    categories_cfg = config["categories"]["categories"]
    category_meta = active_categories(categories_cfg, today)
    week = iso_week_label(today)
    date_value = last_completed_week_value(today)

    summary = {"top_selling_calls": estimate_credits(category_meta), "video_calls": 0, "rising_fast": 0, "new_entries_top10": 0}
    if dry_run:
        calls = summary["top_selling_calls"]
        print(f"[dry run] {len(category_meta)} active categories, {calls} top_selling calls (~{calls} credits).")
        print("No video calls estimated here -- those only happen for brand-new top-10 entries, known only after the real pull.")
        return summary

    old_ranks = compute_old_ranks(week, category_meta)

    run_id = f"{week}-midweek-{uuid.uuid4().hex[:8]}"
    conn = connect(REPO_ROOT / "data" / "radar.db")
    new_pool: list[dict] = []
    async with FastMossClient() as client:
        starting_balance = await check_balance(client)
        hard_cap = max(summary["top_selling_calls"] * 2 + 20, 30)
        tracker = BudgetTracker(hard_cap=hard_cap, starting_balance=starting_balance, run_id=run_id, conn=conn)
        try:
            for key, meta in category_meta.items():
                if "fastmoss_category_id" not in meta:
                    continue
                category_id = meta["fastmoss_category_id"]
                for page in range(1, meta["pages"] + 1):
                    raw = await fetch_top_selling(client, category_id, week=week, date_value=date_value, page=page)
                    raw_ref = save_raw_snapshot(week, f"{MIDWEEK_SNAPSHOT_PREFIX}_{key}_p{page}", raw)
                    for i, row in enumerate(raw.get("list", []), start=(page - 1) * 10 + 1):
                        product, snapshot = normalize_rank_row(row, week=week, rank=i, raw_ref=raw_ref)
                        new_pool.append(
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
                    tracker.checkpoint("midweek_top_selling", balance, note=f"{key} page {page}")

            new_pool = [c for c in new_pool if not c["delisted"]]
            flag_rising_fast(new_pool, old_ranks)
            summary["rising_fast"] = sum(1 for c in new_pool if c["rising_fast"])

            # Reuse existing (Monday's) trend/video snapshots for every
            # candidate -- 0 credits, same find_recent_snapshot cache check
            # enrich_shortlist uses.
            for cand in new_pool:
                trend_raw = find_recent_snapshot(f"trend_{cand['product_id']}", today, 4)
                if trend_raw is not None:
                    days = trend_raw.get("daily_trend", [])
                    cand["daily_units_14"] = [d["daily_units_sold"] for d in days[-14:]] if len(days) >= 14 else None
                    tsum = trend_period_summary(trend_raw)
                    cand["creator_count"] = tsum.get("linked_creator_count")
                    cand["video_count"] = tsum.get("linked_video_count")
                videos_raw = find_recent_snapshot(f"videos_{cand['product_id']}", today, 4)
                if videos_raw is not None:
                    cards = rank_videos_by_sales(video_cards_from_product_video_list(videos_raw))
                    cand["videos"] = cards
                    cand["spanish_share"] = spanish_share([v["caption_text"] for v in cards])

            # Brand-new top-10 entries with no cached video get exactly one
            # product_video_list call each (1cr) -- the only video spend
            # this refresh makes.
            new_top10 = [c for c in new_pool if c["is_new_entry"] and c["rank"] <= NEW_ENTRY_TOP_N and c["videos"] is None]
            for cand in new_top10:
                if tracker.would_exceed(1):
                    break
                try:
                    video_raw = await fetch_product_videos(client, cand["product_id"])
                    save_raw_snapshot(week, f"videos_{cand['product_id']}", video_raw)
                    cards = rank_videos_by_sales(video_cards_from_product_video_list(video_raw))
                    cand["videos"] = cards
                    cand["spanish_share"] = spanish_share([v["caption_text"] for v in cards])
                    summary["video_calls"] += 1
                except FastMossError:
                    pass
                balance = await check_balance(client)
                tracker.checkpoint("midweek_new_entry_video", balance, note=cand["product_id"])
            summary["new_entries_top10"] = len(new_top10)
        except BudgetExceeded as e:
            print(f"BUDGET STOP: {e}")
        summary["credits_spent"] = tracker.spent

    weights = config["weights"]
    clean, flagged = partition_suspicious(new_pool, weights)
    creator_stats = _creator_stats(config)
    df = score_pool(clean, config, creator_stats, today)
    candidate_dicts = candidates_to_export_dicts(
        df, categories_cfg, set(), flagged, weights["saturation_badge"], weights["pocas_latinas"]
    )
    rising_by_id = {c["product_id"]: c["rising_fast"] for c in clean + flagged}
    for cd in candidate_dicts:
        cd["rising_fast"] = rising_by_id.get(cd["product_id"], False)
    export.write_candidates(week, candidate_dicts)

    sweet_spot = tuple(weights["formula_ganadora"]["creator_sweet_spot_seconds"])
    enriched_ids = {c["product_id"] for c in clean if isinstance(c.get("daily_units_14"), list)}
    for cand in clean + flagged:
        export.write_product(
            cand["product_id"],
            product_detail_dict(
                cand, categories_cfg, False, cand["product_id"] in enriched_ids,
                sweet_spot, weights["saturation_badge"], weights["pocas_latinas"],
            ),
        )

    conn.close()
    print(f"Midweek refresh: {summary}")
    return summary


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(midweek_refresh(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
