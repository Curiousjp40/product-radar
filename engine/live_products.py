"""CLI: python -m engine.live_products [--dry-run | --run] [--limit N]

"Lives que venden" paid investigation (2026-10-16 request): for the lives
already surfaced in web/public/data/live_highlights.json (built for free
from engine.posting_time.top_lives_for_l1 / engine.run.
compute_live_highlights_by_category -- zero FastMoss calls), pulls a real
per-live breakdown (products sold, creator info) so the En vivo -> "Lives
que venden" tab can show more than a one-line row for a handful of lives.

THIS MODULE IS DRY-RUN ONLY UNTIL A HUMAN APPROVES A REAL RUN. `dry_run`
defaults to True everywhere, and the CLI requires an explicit `--run` flag
to ever pass dry_run=False -- there is no way to go live by accident. No
function in this module calls a FastMoss tool directly; investigate_live
takes a `client` (FastMossClient or FixtureReplayClient) exactly the way
engine/live_backfill.py and engine/backfill_videos.py do.

Three FastMoss tools, wrapped per-call (cost noted in docs/field_map.md;
field names there are PROVISIONAL, built from each tool's own description
text since no real call has been made yet -- confirm against a real
response before the first paid pilot):
  - live_products_list (1cr/page, pagesize<=10): products sold in one live.
  - live_detail_analysis (2cr): creator info, key performance, category
    breakdown for one live.
  - creator_search (1cr): creator-level profile, cached per handle so a
    creator who hosts multiple investigated lives is never paid for twice.

Caching ("never pay twice" rule): `data/live_products_investigated.json`
holds {"room_ids": [...], "creators": {<handle>: {...creator_search result
shape...}}}. Chosen over a SQLite table because nothing else in engine/
persists a "have we already fetched this, ever" set this way -- the
closest precedent (engine.ingest.find_recent_snapshot, used by
backfill_videos.py) is time-windowed reuse (fetch again after N weeks),
which is wrong here: a live that already happened never needs
re-investigating, and FastMoss has no reason to revise historical sales
for a room_id. A flat JSON file is simple, diffable, and easy for a human
to inspect before/after a pilot run.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from engine.budget import BudgetExceeded, BudgetTracker, check_balance
from engine.client import FastMossConnection
from engine.ingest import save_raw_snapshot
from engine.run import iso_week_label

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = REPO_ROOT / "data" / "live_products_investigated.json"

CREDITS_PER_LIVE = 3  # live_products_list (1) + live_detail_analysis (2)
CREDITS_PER_NEW_CREATOR = 1  # creator_search


def load_investigated_cache(path: Path | None = None) -> dict[str, Any]:
    """Returns {"room_ids": [...], "creators": {...}}, or an empty cache if
    the file doesn't exist yet (first run)."""
    path = path or CACHE_PATH
    if not path.exists():
        return {"room_ids": [], "creators": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_investigated_cache(cache: dict[str, Any], path: Path | None = None) -> None:
    path = path or CACHE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2, default=str), encoding="utf-8")


def select_candidate_lives(
    live_highlights: dict[str, Any],
    tracked_categories: set[str],
    already_investigated: set[str],
    limit: int | None = None,
) -> list[dict]:
    """Pure function, no FastMoss client needed. Flattens
    live_highlights["categories"] restricted to `tracked_categories`,
    dedupes by room_id (categories that share an L1 id repeat identical
    lives -- see engine/posting_time.py and web/src/views/enVivo.ts's own
    dedup for the free highlight list), excludes any room_id already in
    `already_investigated` (the caching/never-pay-twice rule), sorts by
    units_sold descending, and optionally truncates to `limit`."""
    seen_room_ids: set[str] = set()
    candidates: list[dict] = []
    for category, lives in live_highlights.get("categories", {}).items():
        if category not in tracked_categories:
            continue
        for live in lives:
            room_id = live.get("room_id")
            if not room_id or room_id in seen_room_ids or room_id in already_investigated:
                continue
            seen_room_ids.add(room_id)
            candidates.append({**live, "category": category})
    candidates.sort(key=lambda live: live.get("units_sold", 0), reverse=True)
    if limit is not None:
        candidates = candidates[:limit]
    return candidates


async def investigate_live(
    client: FastMossConnection,
    room_id: str,
    creator_handle: str,
    creator_cache: dict[str, dict],
    tracker: BudgetTracker,
    conn: Any,
    lang: str = "EN_US",
    week: str | None = None,
) -> dict:
    """Calls live_products_list and live_detail_analysis for `room_id`
    (checkpointing the budget tracker after each), and calls creator_search
    for `creator_handle` only if it isn't already in `creator_cache` --
    otherwise reuses the cached entry with zero extra calls. Returns the
    combined per-live dict matching export.write_live_products's shape.

    Raw-snapshot rule (added after the 2026-10-16 "Lives que venden" pilot
    lost the full per-live product lists -- the pilot script discarded
    everything but the top 1-3 products per live before any raw response
    ever touched disk): every paid response is written to disk via
    engine.ingest.save_raw_snapshot IMMEDIATELY after the call that
    produced it, before `_combine_live_result` or any other
    trimming/selection logic runs. This happens unconditionally, on every
    call to this function, regardless of what the caller later does with
    the return value -- there is no code path that skips it."""
    week = week or iso_week_label(date.today())

    products_raw = await client.call("live_products_list", {"filter": {"room_id": room_id}, "lang": lang, "pagesize": 10})
    save_raw_snapshot(week, f"liveproducts_{room_id}_products", products_raw)
    balance = await check_balance(client)
    tracker.checkpoint("live_products_list", balance, note=f"room_id={room_id}")

    detail_raw = await client.call("live_detail_analysis", {"filter": {"room_id": room_id}, "lang": lang})
    save_raw_snapshot(week, f"liveproducts_{room_id}_detail", detail_raw)
    balance = await check_balance(client)
    tracker.checkpoint("live_detail_analysis", balance, note=f"room_id={room_id}")

    if creator_handle in creator_cache:
        creator_raw = creator_cache[creator_handle]
    else:
        creator_raw = await client.call("creator_search", {"keywords": creator_handle, "pagesize": 1})
        save_raw_snapshot(week, f"liveproducts_creator_{creator_handle}", creator_raw)
        balance = await check_balance(client)
        tracker.checkpoint("creator_search", balance, note=f"handle={creator_handle}")
        creator_cache[creator_handle] = creator_raw

    return _combine_live_result(room_id, products_raw, detail_raw, creator_raw)


def _combine_live_result(room_id: str, products_raw: dict, detail_raw: dict, creator_raw: dict) -> dict:
    """Maps the three CONFIRMED response shapes (docs/field_map.md, updated
    2026-10-16 against the real 15-live pilot -- the field names below
    replace the earlier provisional guesses, which were wrong in several
    places: live_detail_analysis nests under "performance"/"live", not
    "key_performance", and has no "viewer_count"/"duration_minutes"/
    "started_at" fields directly; creator_search has no bare
    "top_category" field, only "trend_categories" (first entry used here);
    creator_search's creator object uses "unique_id"/"avatar", not
    "handle"/"avatar_url"; live_products_list's per-product fields are
    "cover_url"/"live_units_sold"/"commission_rate_percent", and
    sales_timeline (always empty in the pilot) lives per-product, not
    top-level. Kept separate from investigate_live so it stays a pure
    function, easy to unit test without a client."""
    creator_entries = creator_raw.get("list") or creator_raw.get("creators") or []
    creator = creator_entries[0] if creator_entries else {}
    creator_info = creator.get("creator", creator)
    commerce = creator.get("commerce_summary", {})
    trend_categories = commerce.get("trend_categories") or []
    host = {
        "handle": creator_info.get("unique_id") or creator_info.get("handle") or "",
        "photo_url": creator_info.get("avatar") or creator_info.get("avatar_url") or "",
        "follower_count": creator_info.get("follower_count") or 0,
        # Roxie/Ryan refinement (2026-10-16): the card must also show the
        # host's own 28-day GMV and a 1-line "what they sell" -- both come
        # from creator_search's commerce_summary, never from the live
        # itself. "top_category" isn't a real field; the first
        # trend_categories entry is the closest confirmed equivalent.
        "day28_gmv": commerce.get("day28_gmv", 0.0) or 0.0,
        "top_category": trend_categories[0].get("name", "") if trend_categories else "",
    }

    performance = detail_raw.get("performance", {})
    live_meta = detail_raw.get("live", {})
    viewer_count = performance.get("total_viewer_count", 0) or 0
    units_sold = performance.get("units_sold", 0) or 0
    conversion_rate = round(units_sold / viewer_count, 4) if viewer_count else None  # derived, not a FastMoss field

    duration_seconds = live_meta.get("duration_seconds") or performance.get("session_duration_seconds")
    duration_minutes = round(duration_seconds / 60) if duration_seconds else None

    category_breakdown = []
    for entry in detail_raw.get("category_breakdown", {}).get("by_gmv", []):
        names = entry.get("category_names") or []
        category_breakdown.append(
            {
                "category": names[0] if names else entry.get("category_id"),
                "units_sold_share_percent": entry.get("share"),
            }
        )

    products = []
    for p in products_raw.get("products", []):
        products.append(
            {
                "product_id": p.get("product_id"),
                "title": p.get("title", ""),
                "image_url": p.get("cover_url") or p.get("image_url") or "",
                "price": p.get("price", 0.0) or 0.0,
                "commission_rate": p.get("commission_rate_percent", p.get("commission_rate", 0.0)) or 0.0,
                "units_sold": p.get("live_units_sold", p.get("units_sold", 0)) or 0,
            }
        )

    return {
        "room_id": room_id,
        "host": host,
        "started_at": live_meta.get("start_time"),
        "duration_minutes": duration_minutes,
        "viewer_count": viewer_count,
        "units_sold": units_sold,
        "gmv": performance.get("gmv", 0.0) or 0.0,
        "conversion_rate": conversion_rate,
        "category_breakdown": category_breakdown,
        "sales_timeline": [],
        "products": products,
    }


def estimate_credits(candidates: list[dict], already_investigated_creators: set[str]) -> dict:
    """3cr/live minimum (live_products_list + live_detail_analysis) plus
    1cr per NEW creator handle among the candidates that isn't already in
    the creator cache -- mirrors investigate_live's own cache-hit logic so
    the dry-run estimate matches what a real run would actually spend."""
    new_creator_handles: set[str] = set()
    for live in candidates:
        handle = live.get("creator_handle", "")
        if handle and handle not in already_investigated_creators:
            new_creator_handles.add(handle)
    lives_credits = len(candidates) * CREDITS_PER_LIVE
    creator_credits = len(new_creator_handles) * CREDITS_PER_NEW_CREATOR
    return {
        "lives": len(candidates),
        "new_creators": len(new_creator_handles),
        "lives_credits": lives_credits,
        "creator_credits": creator_credits,
        "total_credits": lives_credits + creator_credits,
    }


async def run_live_products_investigation(
    client: FastMossConnection,
    conn: Any,
    live_highlights: dict[str, Any],
    tracked_categories: set[str],
    already_investigated: set[str],
    run_id: str,
    limit: int | None = None,
    dry_run: bool = True,
    creator_cache: dict[str, dict] | None = None,
    hard_cap: int | None = None,
    week: str | None = None,
) -> dict:
    """Ties select_candidate_lives + investigate_live together.

    dry_run=True (the default, and the ONLY mode this stage is allowed to
    run in without a human approving a real pilot): makes zero FastMoss
    calls, returns the candidate list plus a credit estimate.

    dry_run=False: actually loops investigate_live per candidate,
    respecting tracker.would_exceed/hard_cap (stops gracefully, same
    BudgetExceeded pattern as engine/live_backfill.py), aggregating into
    export.write_live_products's shape."""
    creator_cache = creator_cache if creator_cache is not None else {}
    already_investigated_creators = set(creator_cache.keys())
    candidates = select_candidate_lives(live_highlights, tracked_categories, already_investigated, limit)
    estimate = estimate_credits(candidates, already_investigated_creators)

    if dry_run:
        return {
            "dry_run": True,
            "candidates": candidates,
            "estimate": estimate,
        }

    starting_balance = await check_balance(client)
    cap = hard_cap if hard_cap is not None else max(estimate["total_credits"] * 2, 10)
    tracker = BudgetTracker(hard_cap=cap, starting_balance=starting_balance, run_id=run_id, conn=conn)
    lives: dict[str, dict] = {}
    investigated_room_ids: list[str] = []
    stopped_early = False
    try:
        for live in candidates:
            room_id = live["room_id"]
            if tracker.would_exceed(CREDITS_PER_LIVE):
                stopped_early = True
                break
            result = await investigate_live(
                client, room_id, live.get("creator_handle", ""), creator_cache, tracker, conn, week=week
            )
            lives[room_id] = result
            investigated_room_ids.append(room_id)
    except BudgetExceeded as e:
        stopped_early = True
        print(f"BUDGET STOP: {e}")

    return {
        "dry_run": False,
        "lives": lives,
        "investigated_room_ids": investigated_room_ids,
        "creator_cache": creator_cache,
        "credits_spent": tracker.spent,
        "stopped_early": stopped_early,
    }


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True, help="default; makes zero FastMoss calls")
    parser.add_argument("--run", action="store_true", help="required to actually spend credits; overrides --dry-run")
    parser.add_argument("--limit", type=int, default=15)
    args = parser.parse_args()
    dry_run = not args.run

    from engine.config import load_all

    highlights_path = REPO_ROOT / "web" / "public" / "data" / "live_highlights.json"
    live_highlights = json.loads(highlights_path.read_text(encoding="utf-8"))
    categories_cfg = load_all()["categories"]["categories"]
    tracked_categories = {
        key for key, cfg in categories_cfg.items() if cfg.get("tier") in ("core", "secondary", "seasonal")
    }
    cache = load_investigated_cache()
    already_investigated = set(cache["room_ids"])

    candidates = select_candidate_lives(live_highlights, tracked_categories, already_investigated, args.limit)
    estimate = estimate_credits(candidates, set(cache["creators"].keys()))
    print(f"[dry run] {len(candidates)} candidate lives (limit {args.limit}), estimate: {estimate}")
    for live in candidates:
        print(
            f"  room_id={live['room_id']} creator={live.get('creator_handle')} "
            f"units_sold={live.get('units_sold')} category={live.get('category')}"
        )

    if not dry_run:
        print("--run was passed, but this stage is dry-run/fixture only per the 2026-10-16 brief -- refusing to make real calls.")


if __name__ == "__main__":
    main()
