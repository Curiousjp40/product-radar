"""CLI: python -m engine.live_backfill [--dry-run]

Part C7b's monthly live-timing pull (confirmed working 2026-10-16, see
docs/field_map.md): fetches live_search for each of our 5 distinct L1
category ids (config/weights.yaml's live_timing.category_to_l1_id),
config['live_timing']['pages_per_category'] pages each (10 lives/page,
the tool's own cap), with the sold_range.min filter that's what actually
keeps results to lives that sold something. Meant to run once a month,
right after the credit reset -- not every week like the video backfill.

--dry-run makes zero calls and just prints what would be fetched (how
many L1 groups, how many pages, the credit estimate).
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

from engine.budget import BudgetExceeded, BudgetTracker, check_balance
from engine.client import FastMossClient, FastMossError
from engine.config import load_all
from engine.db import connect
from engine.ingest import fetch_live_search, save_raw_snapshot
from engine.run import iso_week_label

REPO_ROOT = Path("C:/Users/Owner/OneDrive/Desktop/Amex/product-radar")
DB_PATH = REPO_ROOT / "data" / "radar.db"


async def live_backfill(dry_run: bool = True, today: date | None = None) -> dict:
    today = today or date.today()
    config = load_all()
    live_cfg = config["weights"]["live_timing"]
    l1_ids = sorted(set(live_cfg["category_to_l1_id"].values()))
    pages = live_cfg["pages_per_category"]
    window_days = live_cfg["window_days"]
    buffer_days = live_cfg["window_end_buffer_days"]

    end = datetime.combine(today - timedelta(days=buffer_days), datetime.min.time(), tzinfo=UTC)
    start = end - timedelta(days=window_days)
    start_min, start_max = int(start.timestamp()), int(end.timestamp())

    total_calls = len(l1_ids) * pages
    summary = {
        "l1_ids": l1_ids,
        "pages_per_category": pages,
        "total_calls": total_calls,
        "fetched": 0,
        "failed": 0,
        "credits_spent": 0,
    }

    if dry_run:
        print(f"[dry run] {len(l1_ids)} L1 categories x {pages} pages = {total_calls} calls (~{total_calls} credits, 1cr each).")
        print(f"  L1 ids: {l1_ids}")
        print(f"  Window: {start.date()} to {end.date()} ({window_days}d, {buffer_days}d buffer)")
        return summary

    week = iso_week_label(today)
    run_id = f"{week}-live-{uuid.uuid4().hex[:8]}"
    conn = connect(DB_PATH)
    async with FastMossClient() as client:
        starting_balance = await check_balance(client)
        tracker = BudgetTracker(hard_cap=max(total_calls * 3, 10), starting_balance=starting_balance, run_id=run_id, conn=conn)
        try:
            for l1_id in l1_ids:
                sold_min = live_cfg["sold_range_min_by_l1_id"].get(l1_id, 5)
                for page in range(1, pages + 1):
                    try:
                        raw = await fetch_live_search(client, l1_id, start_min, start_max, sold_min, page=page)
                        save_raw_snapshot(week, f"live_{l1_id}_p{page}", raw)
                        summary["fetched"] += 1
                    except FastMossError as e:
                        summary["failed"] += 1
                        print(f"  FAILED l1={l1_id} page={page}: {e}")
                    balance = await check_balance(client)
                    tracker.checkpoint("live_search", balance, note=f"l1={l1_id} page={page}")
                    print(f"  l1={l1_id} page={page}: balance now {balance}")
        except BudgetExceeded as e:
            print(f"BUDGET STOP: {e}")
        summary["credits_spent"] = tracker.spent
    conn.close()
    return summary


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    summary = asyncio.run(live_backfill(dry_run=args.dry_run))
    print(summary)


if __name__ == "__main__":
    main()
