"""Raw FastMoss tool responses -> typed models (engine/models.py), per the
confirmed mappings in docs/field_map.md. Nothing here guesses a field name --
every mapping was seen in a real Phase 0/1 response.
"""

from __future__ import annotations

import re
from datetime import date

from engine.models import CreatorVideo, Product, ProductDaily, ProductSnapshot
from engine.timeutil import unix_ts_to_eastern

_HASHTAG_RE = re.compile(r"#(\w+)")
_REPLY_PATTERNS = ("replying to @", "respuesta a @")


def commission_rate_fraction(commission_rate_percent: float) -> float:
    """FastMoss returns a percent-integer (15 means 15%), not a 0-1 fraction."""
    return commission_rate_percent / 100


def growth_rate_fraction(units_sold_growth_rate_percent: float) -> float:
    """Same percent-integer convention as commission_rate_percent."""
    return units_sold_growth_rate_percent / 100


def normalize_rank_row(
    row: dict,
    *,
    week: str,
    rank: int,
    source: str = "top_selling",
    is_weekly_period: bool = True,
    raw_ref: str | None = None,
) -> tuple[Product, ProductSnapshot]:
    """One row from product_rank_top_selling's `list` -> (Product, ProductSnapshot).

    `rank` is the row's 1-based position in the list FastMoss already sorted
    for us -- there's no explicit rank field on the response. `period_gmv`/
    `period_units_sold` map to the 7-day fields only when the ranking call
    used date_type="week" (`is_weekly_period`); otherwise they're left for
    the caller to place correctly.
    """
    category = row.get("category", {})
    shop = row.get("shop", {})
    product = Product(
        product_id=row["product_id"],
        title=row["title"],
        image_url=row.get("cover_url"),
        category_l1=category.get("l1", {}).get("name", ""),
        category_l2=category.get("l2", {}).get("name"),
        shop_id=shop.get("shop_id", ""),
        shop_name=shop.get("shop_name", ""),
        first_seen_week=week,
        launch_date=date.fromisoformat(row["launch_date"]) if row.get("launch_date") else None,
        delisted=bool(row.get("is_off_shelf", False)),
    )
    snapshot = ProductSnapshot(
        week=week,
        product_id=row["product_id"],
        source=source,
        rank=rank,
        price=row.get("floor_price", 0.0),
        price_min=row.get("floor_price"),
        price_max=row.get("ceiling_price"),
        commission_rate=commission_rate_fraction(row.get("commission_rate_percent", 0)),
        units_7d=row.get("period_units_sold") if is_weekly_period else None,
        gmv_7d=row.get("period_gmv") if is_weekly_period else None,
        units_total=row.get("total_units_sold"),
        growth_rate=growth_rate_fraction(row.get("units_sold_growth_rate_percent", 0)),
        raw_ref=raw_ref,
    )
    return product, snapshot


def normalize_daily_trend(product_id: str, trend_result: dict) -> list[ProductDaily]:
    return [
        ProductDaily(
            product_id=product_id,
            day=date.fromisoformat(d["date"]),
            units=d["daily_units_sold"],
            gmv=d["daily_gmv"],
        )
        for d in trend_result.get("daily_trend", [])
    ]


def trend_period_summary(trend_result: dict) -> dict:
    """linked_creator_count / linked_video_count / linked_live_count --
    confirmed to live here (product_sales_trend), not on the ranking
    endpoint. See docs/field_map.md."""
    return trend_result.get("period_summary", {})


def extract_hashtags(caption_text: str) -> list[str]:
    return _HASHTAG_RE.findall(caption_text or "")


def is_reply_caption(caption_text: str) -> bool:
    text = (caption_text or "").lower()
    return any(text.startswith(p) for p in _REPLY_PATTERNS)


def normalize_creator_video(row: dict, creator_handle: str) -> CreatorVideo:
    """One row from creator_video_analysis's video_list.list -> CreatorVideo.
    duration_seconds (not duration_s), flat engagement/commerce fields (not
    nested like video_search's), published_at converted to America/New_York
    (FastMoss timestamps are confirmed UTC+8 -- see docs/field_map.md)."""
    caption = row.get("caption_text", "")
    linked = row.get("linked_products") or []
    product_id = linked[0]["product_id"] if linked else None
    return CreatorVideo(
        video_id=row["video_id"],
        creator=creator_handle,
        published_at=unix_ts_to_eastern(row["published_at"]),
        duration_s=row.get("duration_seconds", 0),
        title=caption,
        product_id=product_id,
        views=row.get("play_count", 0),
        units=row.get("video_units_sold", 0),
        gmv=row.get("video_gmv", 0.0),
        likes=row.get("like_count", 0),
        hashtags=extract_hashtags(caption),
        is_reply=is_reply_caption(caption),
        url=f"https://www.tiktok.com/@{creator_handle}/video/{row['video_id']}",
        interaction_rate_pct=row.get("interaction_rate_percent"),
    )


def video_search_item_to_caption(item: dict) -> str:
    """video_search's items carry caption_text too -- used for the Spanish-gap
    signal (section 6.8)."""
    return item.get("caption_text", "")


def ads_share_pct_from_overview(overview_result: dict) -> float | None:
    """Ad-vs-organic traffic share from product_overview's ads_distribution,
    as a percent number (matching commission_rate_percent's convention) for
    engine.scoring.risk_penalty's ads_share_pct.

    Confirmed shape (tests/fixtures/fastmoss_product_overview.json):
    `ads_distribution.breakdown` is a list of rows with a `traffic_source`
    tag ("ad_traffic" seen; everything else is organic) and a
    `gmv_share_percent`. Returns None if no "ad_traffic" row is present.
    """
    rows = overview_result.get("ads_distribution", {}).get("breakdown", [])
    for row in rows:
        if row.get("traffic_source") == "ad_traffic":
            return row.get("gmv_share_percent")
    return None


def lead_counts_from_overview(overview_result: dict) -> tuple[float, float, float, float] | None:
    """(creator_count_last7, creator_count_prior7, video_count_last7,
    video_count_prior7) for engine.features.lead_raw, section 6.2.

    Confirmed shape: `daily_trend[].daily_new_linked_creator_count` and
    `.daily_new_linked_video_count` are per-day new-promoter counts -- sum
    the last 7 entries and the 7 before that. Needs >= 14 days of daily_trend
    (product_overview with time_range_days >= 14); returns None otherwise.
    """
    days = overview_result.get("daily_trend", [])
    if len(days) < 14:
        return None
    last14 = days[-14:]
    prior7, last7 = last14[:7], last14[7:14]
    creator_last7 = sum(d.get("daily_new_linked_creator_count", 0) for d in last7)
    creator_prior7 = sum(d.get("daily_new_linked_creator_count", 0) for d in prior7)
    video_last7 = sum(d.get("daily_new_linked_video_count", 0) for d in last7)
    video_prior7 = sum(d.get("daily_new_linked_video_count", 0) for d in prior7)
    return creator_last7, creator_prior7, video_last7, video_prior7
