"""CLI: python -m engine.backfill_videos [--dry-run] [--limit N]

Part C1a one-time backfill (approved 2026-10-16, after the 2,000-credit
top-up): fetches product_video_list for every non-suspicious candidate in
the current web/public/data/candidates.json that doesn't already have a
reusable video snapshot, so every product gets videos/hashtags/formula_
ganadora/posting-times instead of just the top ~30 a normal weekly run
enriches. Reuses the exact same find_recent_snapshot check enrich_shortlist
uses (engine/run.py) -- a product with a snapshot from the last
video_cache_max_weeks (config/weights.yaml) is skipped, 0 credits, so a
rerun after a stop-and-resume only pays for what's still missing. This is
the same reuse check that failed once before and wasted ~45 credits
(2026-10-15) -- `--dry-run` runs the identical skip/fetch decision for
every product with zero FastMoss calls, so it can be checked before
spending anything for real.

Does NOT re-run the discovery/ranking stages (fetch_top_selling etc.) --
those already ran in the last real weekly run and cost their own credits;
this only fills in videos for products already on the list.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

from engine.budget import BudgetExceeded, BudgetTracker, check_balance
from engine.client import FastMossClient, FastMossError
from engine.db import connect
from engine.images import cache_image
from engine.ingest import fetch_product_videos, find_recent_snapshot, save_raw_snapshot
from engine.normalize import rank_videos_by_sales, video_cards_from_product_video_list
from engine.run import iso_week_label

REPO_ROOT = Path(__file__).resolve().parent.parent
CANDIDATES_PATH = REPO_ROOT / "web" / "public" / "data" / "candidates.json"
DB_PATH = REPO_ROOT / "data" / "radar.db"


def load_backfill_targets() -> list[dict]:
    """Every non-suspicious candidate from the last real export -- this is
    the ~250-product list Roxie already sees, not a fresh (paid) ingest."""
    data = json.loads(CANDIDATES_PATH.read_text(encoding="utf-8"))
    return [c for c in data["candidates"] if not c.get("suspicious")]


async def backfill_videos(
    dry_run: bool = True,
    limit: int | None = None,
    cache_max_weeks_old: int = 4,
    today: date | None = None,
) -> dict:
    """Returns a summary dict: {total, already_cached, fetched, failed,
    credits_spent}. In dry-run mode, 'fetched' counts what WOULD be
    fetched -- no FastMoss calls are made and credits_spent is always 0."""
    today = today or date.today()
    targets = load_backfill_targets()

    already_cached, to_fetch = [], []
    for c in targets:
        snap = find_recent_snapshot(f"videos_{c['product_id']}", today, cache_max_weeks_old)
        (already_cached if snap is not None else to_fetch).append(c)
    # --limit caps how many of the (already identified) to-fetch products
    # actually get a paid call, not the raw candidate list -- otherwise a
    # small --limit test run could land entirely on already-cached
    # products and spend/verify nothing.
    if limit is not None:
        to_fetch = to_fetch[:limit]

    summary = {
        "total": len(targets),
        "already_cached": len(already_cached),
        "to_fetch": len(to_fetch),
        "fetched": 0,
        "failed": 0,
        "credits_spent": 0,
    }
    if dry_run:
        print(
            f"[dry run] {len(targets)} non-suspicious candidates: "
            f"{len(already_cached)} already have a reusable snapshot (<= {cache_max_weeks_old} weeks old), "
            f"{len(to_fetch)} would be fetched (~{len(to_fetch)} credits, product_video_list @ 1cr each)."
        )
        return summary

    week = iso_week_label(today)
    run_id = f"{week}-backfill-{uuid.uuid4().hex[:8]}"
    conn = connect(DB_PATH)
    async with FastMossClient() as client:
        starting_balance = await check_balance(client)
        # 1 credit/call expected -- a 3x buffer still catches a real runaway
        # (e.g. an API change that silently costs more per call) without
        # tripping on ordinary per-call variance.
        hard_cap = max(len(to_fetch) * 3, 10)
        tracker = BudgetTracker(hard_cap=hard_cap, starting_balance=starting_balance, run_id=run_id, conn=conn)
        try:
            for i, c in enumerate(to_fetch):
                product_id = c["product_id"]
                try:
                    raw = await fetch_product_videos(client, product_id)
                    save_raw_snapshot(week, f"videos_{product_id}", raw)
                    cards = rank_videos_by_sales(video_cards_from_product_video_list(raw))
                    for card in cards:
                        cached_cover = cache_image(card.get("cover_url"), f"video_{card['video_id']}")
                        if cached_cover:
                            card["cover_url"] = cached_cover
                    summary["fetched"] += 1
                except FastMossError as e:
                    summary["failed"] += 1
                    print(f"  FAILED {product_id}: {e}")
                balance = await check_balance(client)
                tracker.checkpoint("backfill_videos", balance, note=f"{i + 1}/{len(to_fetch)} product {product_id}")
                print(f"  [{i + 1}/{len(to_fetch)}] {product_id}: balance now {balance}")
        except BudgetExceeded as e:
            print(f"BUDGET STOP: {e}")
        summary["credits_spent"] = tracker.spent
    conn.close()
    return summary


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    summary = asyncio.run(backfill_videos(dry_run=args.dry_run, limit=args.limit))
    print(summary)


if __name__ == "__main__":
    main()
