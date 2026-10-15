"""Pulls rankings, trends, overviews, and video search from FastMoss MCP.
Each function is a thin, budget-aware wrapper around one tool call (or one
call per item in a small list) -- engine/run.py decides how much to pull and
checks the budget between stages.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from engine.client import FastMossConnection

SNAPSHOTS_DIR = Path(__file__).resolve().parent.parent / "data" / "snapshots"


def save_raw_snapshot(week: str, name: str, payload: dict[str, Any]) -> str:
    """Writes a raw API response to data/snapshots/<week>/<name>.json (spec
    section 3.1: "raw JSON snapshots per week"). Returns the path relative to
    the repo root, for ProductSnapshot.raw_ref."""
    week_dir = SNAPSHOTS_DIR / week
    week_dir.mkdir(parents=True, exist_ok=True)
    path = week_dir / f"{name}.json"
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return f"data/snapshots/{week}/{name}.json"


async def resolve_category_ids(client: FastMossConnection, queries: dict[str, str]) -> dict[str, dict]:
    """`queries`: our category key -> a natural-language search term. Returns
    our category key -> the best-scoring match from search_category_by_words
    (free). Caller picks which level (l1/l2/l3) to actually query with."""
    result = await client.call("search_category_by_words", {"query": list(queries.values()), "top_k": 5})
    by_query: dict[str, dict] = {}
    for cat in result.get("categories", []):
        q = cat.get("matched_query")
        if q and (q not in by_query or cat["score"] > by_query[q]["score"]):
            by_query[q] = cat
    return {key: by_query[term] for key, term in queries.items() if term in by_query}


async def fetch_top_selling(
    client: FastMossConnection,
    category_id: int,
    *,
    week: str,
    date_value: str,
    region: str = "US",
    page: int = 1,
    pagesize: int = 10,
) -> dict:
    """Ranked by units sold this period, not GMV (changed 2026-10-18 for the
    "top 50 by units sold" full list) -- `pagesize` is capped at 10 by the
    tool itself, so getting 50 needs 5 separate paged calls (1 credit each)."""
    return await client.call(
        "product_rank_top_selling",
        {
            "filter": {"category_id": category_id, "date_type": "week", "date_value": date_value, "region": region},
            "orderby": [{"field": "period_units_sold", "order": "desc"}],
            "page": page,
            "pagesize": pagesize,
        },
    )


async def fetch_daily_trend(client: FastMossConnection, product_id: str, time_range_days: int = 14) -> dict:
    return await client.call(
        "product_sales_trend", {"filter": {"product_id": product_id, "time_range_days": time_range_days}}
    )


async def fetch_overview(client: FastMossConnection, product_id: str, time_range_days: int = 28) -> dict:
    return await client.call("product_overview", {"filter": {"product_id": product_id, "time_range_days": time_range_days}})


async def fetch_product_videos(
    client: FastMossConnection,
    product_id: str,
    *,
    time_range_days: int = 90,
    pagesize: int = 10,
) -> dict:
    """Videos FastMoss has linked to this specific product (section 6.8's
    Spanish-gap input, and the dashboard's "videos selling this product"
    section) -- added 2026-10-15 to replace `video_search`'s free-text
    keyword search, which matched loosely and surfaced unrelated videos
    (homecoming, movie trailers) for products whose titles happened to share
    common words. Filtering by `product_id` returns only videos genuinely
    linked to it; confirmed via one real call, see docs/field_map.md.

    pagesize raised 6 -> 10 (same 1 credit either way) so
    `rank_videos_by_sales` (engine/normalize.py) has more videos to rank by
    actual sales from. `orderby` sorts by `units_sold` now -- the live tool
    schema (not docs/fastmoss_tools.json's original, incomplete capture)
    confirms `units_sold` is a real, documented field (also gmv,
    digg_count, play_count, share_count). Found for free via the tool's own
    schema, no paid test call needed. Kept as a best-effort request, not
    full trust: rank_videos_by_sales still re-sorts client-side regardless,
    since the API's single-field sort can't replicate our GMV/play_count
    tiebreak order."""
    return await client.call(
        "product_video_list",
        {
            "filter": {"product_id": product_id, "time_range_days": time_range_days},
            "orderby": [{"field": "units_sold", "order": "desc"}],
            "pagesize": pagesize,
        },
    )


def load_raw_snapshot(week: str, name: str) -> dict[str, Any] | None:
    path = SNAPSHOTS_DIR / week / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
