"""Suspicious-listing detection, added 2026-10-15 after the first real run
surfaced a dropshipping cluster: three products from one shop ("peaouter"),
all priced at an identical round $200 regardless of category (Hooks &
Shelves, Clocks, Decorative Stickers), two with boilerplate templated
titles -- nothing in the scoring pipeline (section 6) catches that kind of
listing on its own, since GMV/growth/price alone can look fine.

Each rule here is independent and OR'd together by `suspicious_reasons` --
a candidate is excluded if any rule fires. "Use the saved product_overview
channel/content split where available" (spec: real data confirmed Phase 1)
means the GMV-but-few-creators rule degrades gracefully to None (not
evaluated) when no overview data was fetched for that candidate, rather than
flagging everything it can't check.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from engine.stats import jaccard, tokenize_title

_BOILERPLATE_PHRASES = (
    "contact customer service",
    "meticulous wrap",
    "fast shipping",
    "quick delivery",
    "promptly shipped",
    "please contact",
    "for inquiries",
    "warranty card",
    "thank you card",
)


def is_boilerplate_title(title: str, phrases: Sequence[str] = _BOILERPLATE_PHRASES) -> bool:
    text = title.lower()
    return any(p in text for p in phrases)


def is_price_outlier(price: float, category_median_price: float, multiplier: float = 4.0) -> bool:
    if category_median_price <= 0:
        return False
    return price > multiplier * category_median_price


def is_round_price(price: float, divisor: float = 50) -> bool:
    """A suspiciously round price, e.g. an exact multiple of $50."""
    return price > 0 and price % 1 == 0 and price % divisor == 0


def shop_round_price_cluster_ids(
    candidates: Sequence[dict],
    round_divisor: float = 50,
    min_cluster: int = 2,
    title_jaccard_threshold: float = 0.3,
) -> set[str]:
    """Flags products sharing both a shop and an identical round price, when
    their titles are NOT near-duplicates -- i.e. not just size/color variants
    of one product (which legitimately share a price), but unrelated listings
    (spec example: hooks, clocks, and stickers all at exactly $200)."""
    flagged: set[str] = set()
    by_shop_price: dict[tuple[str, float], list[dict]] = {}
    for c in candidates:
        if is_round_price(c["price"], round_divisor):
            by_shop_price.setdefault((c["shop_id"], c["price"]), []).append(c)
    for group in by_shop_price.values():
        if len(group) < min_cluster:
            continue
        unrelated = any(
            jaccard(tokenize_title(group[i]["title"]), tokenize_title(group[j]["title"])) < title_jaccard_threshold
            for i in range(len(group))
            for j in range(i + 1, len(group))
        )
        if unrelated:
            flagged.update(c["product_id"] for c in group)
    return flagged


def has_low_creator_density(
    gmv_7d: float,
    creator_count: float | None,
    gmv_threshold: float = 20_000,
    min_creators: int = 5,
) -> bool | None:
    """High GMV but very few linked creators = sales look buyer/ad-driven,
    not content-driven. None (not True/False) when creator_count wasn't
    fetched for this candidate -- can't evaluate, so don't flag it."""
    if creator_count is None:
        return None
    return gmv_7d > gmv_threshold and creator_count < min_creators


def low_affiliate_channel_share(
    channel_breakdown: list[dict] | None,
    threshold_pct: float = 20,
) -> bool | None:
    """From product_overview's channel_distribution.breakdown (confirmed
    shape: a list of {sales_channel, gmv_share_percent, ...} rows). True if
    the creator-driven "affiliate" channel's GMV share is below
    threshold_pct -- sales aren't actually coming from content creators.
    None if no overview data (and so no channel breakdown) is available."""
    if not channel_breakdown:
        return None
    for row in channel_breakdown:
        if row.get("sales_channel") == "affiliate":
            return row.get("gmv_share_percent", 0) < threshold_pct
    return None


def off_category_drop_reason(title: str, category_cfg: dict) -> str | None:
    """Roxie's "block stickers + off-category items in home" request
    (2026-10-16): config/categories.yaml's home_decor/home_storage entries
    got `exclude_title_keywords` (wall stickers, decals, tape... keep
    showing up under the "Decoration" FastMoss category id even though
    they aren't decor) and home_decor additionally got
    `require_title_keywords` (an item must mention an actual decor term --
    without it, something like an "Onyx Silent Vibration Wrist-Worn
    Device" alarm slips through just because FastMoss filed it there).

    Keyword matching is whole-word (`\\b`), not substring -- a real run
    caught "magnet" as an exclude keyword also matching "magnetic" in
    legitimate storage-bin titles ("Magnetic Doors", "magnetic transparent
    door shoe cabinet"), wrongly dropping them for a Christmas-magnet
    keyword that was never meant to touch that word.

    Returns a human-readable drop reason, or None if the title is fine."""
    text = title.lower()

    def word_in_text(keyword: str) -> bool:
        return re.search(rf"\b{re.escape(keyword.lower())}\b", text) is not None

    for kw in category_cfg.get("exclude_title_keywords", []):
        if word_in_text(kw):
            return f"matched excluded keyword {kw!r}"
    required = category_cfg.get("require_title_keywords")
    if required and not any(word_in_text(kw) for kw in required):
        return "title doesn't match any required decor keyword"
    return None


def filter_off_category(candidates: Sequence[dict], categories_cfg: dict) -> tuple[list[dict], list[dict]]:
    """Splits `candidates` into (kept, dropped) using `off_category_drop_reason`
    against each candidate's own config_category entry. Dropped items carry
    a `drop_reason` field so the caller can log exactly what was removed and
    why -- this is a hard drop (unlike partition_suspicious's flagged-but-
    exported items), since these aren't suspicious, they're simply not the
    right kind of product for the category at all."""
    kept: list[dict] = []
    dropped: list[dict] = []
    for c in candidates:
        category_cfg = categories_cfg.get(c["config_category"], {})
        reason = off_category_drop_reason(c["title"], category_cfg)
        if reason is None:
            kept.append(c)
        else:
            dropped.append({**c, "drop_reason": reason})
    return kept, dropped


def suspicious_reasons(
    candidate: dict,
    category_median_price: float,
    shop_price_cluster_ids: set[str],
    price_outlier_multiplier: float = 4.0,
    low_density_gmv_threshold: float = 20_000,
    low_density_min_creators: int = 5,
    low_affiliate_share_threshold_pct: float = 20,
) -> list[str]:
    """Human-readable reasons this candidate looks like a suspicious listing;
    an empty list means it passed every check."""
    reasons: list[str] = []
    if is_price_outlier(candidate["price"], category_median_price, price_outlier_multiplier):
        reasons.append(
            f"price ${candidate['price']:.2f} is over {price_outlier_multiplier:.0f}x "
            f"the category median (${category_median_price:.2f})"
        )
    if is_boilerplate_title(candidate["title"]):
        reasons.append("boilerplate/templated title")
    if candidate["product_id"] in shop_price_cluster_ids:
        reasons.append("shares an identical round price with unrelated products from the same shop")
    if has_low_creator_density(
        candidate["gmv_7d"], candidate.get("creator_count"), low_density_gmv_threshold, low_density_min_creators
    ):
        reasons.append("high GMV but very few linked creators (sales look buyer/ad-driven, not content-driven)")
    if low_affiliate_channel_share(candidate.get("channel_breakdown"), low_affiliate_share_threshold_pct):
        reasons.append("most sales come through non-affiliate channels (product card/shop), not creator content")
    return reasons
