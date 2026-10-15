"""Part B: "Formula Ganadora" -- plain, data-backed advice for the next
video, derived entirely from a product's already-saved top-selling videos
(0 FastMoss credits; added 2026-10-15 as part of turning Product Radar into
a creator-workflow tool, not a FastMoss copy). Every function here is pure
and takes video dicts already ranked by sales (see
engine.normalize.rank_videos_by_sales) -- "top" always means top by sales,
never by plays. Also used for the "Hashtags de la semana" aggregate on the
Hoy page (weekly_top_hashtags), which just flattens several products' video
lists through the same weighting.
"""

from __future__ import annotations

import re
from collections import Counter
from statistics import median

from engine.normalize import extract_hashtags, is_reply_caption
from engine.timeutil import unix_ts_to_eastern

_PRICE_MENTION_RE = re.compile(r"[$€]\s?\d")
_HASHTAG_STRIP_RE = re.compile(r"#\w+")
_MENTION_STRIP_RE = re.compile(r"@\w+")
_SENTENCE_END_RE = re.compile(r"[.!?\n]")


def top_hashtags_weighted(videos: list[dict], limit: int = 8) -> list[dict]:
    """Top hashtags across `videos`, weighted by each video's units sold --
    a hashtag on a video that sold 500 counts more than one that sold 2, not
    one-vote-per-video. Returns [{"hashtag": str, "weight": int}], best
    first; empty list if no video has any hashtag."""
    weights: dict[str, int] = {}
    for v in videos:
        units = v.get("window_units_sold") or 0
        for tag in extract_hashtags(v.get("caption_text", "")):
            key = tag.lower()
            weights[key] = weights.get(key, 0) + units
    ranked = sorted(weights.items(), key=lambda kv: kv[1], reverse=True)
    return [{"hashtag": h, "weight": w} for h, w in ranked[:limit]]


def weekly_top_hashtags(picks_videos: list[list[dict]], limit: int = 15) -> list[dict]:
    """"Hashtags de la semana" (Hoy page): top hashtags across ALL of this
    week's picks' top videos, same units-sold weighting as
    top_hashtags_weighted -- just flattened across products first."""
    return top_hashtags_weighted([v for videos in picks_videos for v in videos], limit=limit)


def ideal_duration_seconds(videos: list[dict], creator_sweet_spot_seconds: tuple[int, int]) -> dict:
    """Median duration of `videos` that actually have a duration, else the
    creator's own best-performing length bucket range (section 2's
    length_sweet_spot -- passed in, not computed here, since that's a
    creator-level stat, not a per-product one). Returns {"seconds": int,
    "source": "videos"} or {"seconds": None, "source": "creator_default",
    "sweet_spot_range": [lo, hi]}."""
    durations = [v["duration_seconds"] for v in videos if v.get("duration_seconds") is not None]
    if durations:
        return {"seconds": round(median(durations)), "source": "videos"}
    return {"seconds": None, "source": "creator_default", "sweet_spot_range": list(creator_sweet_spot_seconds)}


def format_stats(videos: list[dict]) -> dict:
    """% of `videos` that are replies to a comment, % that mention the price
    in the caption, % that are ads. All zero for an empty list (no data to
    show, not a real 0%)."""
    if not videos:
        return {"reply_pct": 0.0, "price_mention_pct": 0.0, "ad_pct": 0.0}
    n = len(videos)
    replies = sum(1 for v in videos if is_reply_caption(v.get("caption_text", "")))
    price_mentions = sum(1 for v in videos if _PRICE_MENTION_RE.search(v.get("caption_text") or ""))
    ads = sum(1 for v in videos if v.get("is_ad"))
    return {
        "reply_pct": round(100 * replies / n, 1),
        "price_mention_pct": round(100 * price_mentions / n, 1),
        "ad_pct": round(100 * ads / n, 1),
    }


def best_posting_hour(videos: list[dict]) -> dict | None:
    """Most common posting hour (America/New_York, via
    engine.timeutil.unix_ts_to_eastern -- a FastMoss published_at unix
    timestamp is timezone-agnostic truth, no UTC+8 shift needed, unlike the
    *_display string fields) among `videos` with a real `published_at`.
    Returns {"hour_start": 0-23, "hour_end": 0-23} (a 2-hour display window,
    e.g. 19 -> "7-9 PM") or None if no video has a timestamp."""
    hours = [unix_ts_to_eastern(v["published_at"]).hour for v in videos if v.get("published_at")]
    if not hours:
        return None
    most_common_hour, _ = Counter(hours).most_common(1)[0]
    return {"hour_start": most_common_hour, "hour_end": (most_common_hour + 2) % 24}


def extract_hook(caption_text: str) -> str:
    """The first sentence of a caption (the "hook"), cleaned of hashtags and
    @mentions, in its original language -- never translated, these are a
    real creator's real words. Splits on the first `.`/`!`/`?`/newline; with
    none of those, returns the whole (cleaned) caption."""
    text = (caption_text or "").strip()
    match = _SENTENCE_END_RE.search(text)
    if match is None:
        first_sentence = text
    elif match.group() == "\n":
        first_sentence = text[: match.start()]  # no punctuation to keep
    else:
        # Keep the sentence-ending punctuation itself (., !, ?) -- "Mira
        # este cambio!" reads as a real hook; without it, it doesn't.
        first_sentence = text[: match.end()]
    cleaned = _HASHTAG_STRIP_RE.sub("", first_sentence)
    cleaned = _MENTION_STRIP_RE.sub("", cleaned)
    return " ".join(cleaned.split())


def _is_quality_hook(text: str) -> bool:
    """Filters out junk "hooks" (added 2026-10-15): fewer than 3 words
    ("Love", "So good"), or no actual letters at all (pure emoji/hashtag
    remnants/punctuation) -- these showed up as suggested hooks on the Hoy
    tab and read as useless noise, not something she could say on camera."""
    if not text:
        return False
    if len(text.split()) < 3:
        return False
    return any(ch.isalpha() for ch in text)


def top_hooks(videos: list[dict], limit: int = 3) -> list[str]:
    """The hook (extract_hook) of the best `limit` QUALITY captions, scanning
    `videos` in order. `videos` must already be ranked by sales
    (engine.normalize.rank_videos_by_sales) -- this never re-ranks, it just
    keeps looking past a junk or empty hook instead of stopping at the first
    `limit` videos regardless of whether their hooks are any good."""
    hooks: list[str] = []
    for v in videos:
        hook = extract_hook(v.get("caption_text", ""))
        if _is_quality_hook(hook):
            hooks.append(hook)
        if len(hooks) >= limit:
            break
    return hooks


def formula_ganadora_dict(videos: list[dict], creator_sweet_spot_seconds: tuple[int, int]) -> dict:
    """Assembles the full "Formula Ganadora" box for one product's page."""
    return {
        "top_hashtags": top_hashtags_weighted(videos),
        "ideal_duration": ideal_duration_seconds(videos, creator_sweet_spot_seconds),
        "format_stats": format_stats(videos),
        "best_posting_hour": best_posting_hour(videos),
        "top_hooks": top_hooks(videos),
    }
