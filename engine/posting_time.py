"""Part C7a: best time to post a video, computed for free from videos we've
already fetched (data/snapshots/*/videos_*.json) -- no FastMoss calls. Pools
every saved video across every week, dedupes by video_id, converts each
published_at (Unix seconds) to America/New_York, and ranks 2-hour windows
and weekdays by MEDIAN units sold (not sums -- one viral 4 AM video
shouldn't make 4 AM look like the best time). Falls back from a product's
own videos up through its category, its group, to everything pooled, and
prefers organic-only videos once that subset itself has enough samples
(ads are timed by the advertiser, not by when an audience is naturally
online)."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

MIN_PRODUCT_VIDEOS = 5
MIN_POOL_VIDEOS = 30
MIN_ORGANIC_VIDEOS = 30


def _hour_window(hour: int) -> tuple[int, int]:
    start = (hour // 2) * 2
    return start, start + 2


def load_video_records(snapshots_dir: Path) -> list[dict]:
    """Every saved video across every week's videos_*.json, deduped by
    video_id (the same video can be re-fetched across weeks for the same
    product). Each record: video_id, product_id, is_ad, units, weekday
    (0=Monday, America/New_York), hour_start/hour_end (2-hour ET window)."""
    seen: dict[str, dict] = {}
    if not snapshots_dir.exists():
        return []
    for snap_dir in sorted(snapshots_dir.glob("*")):
        if not snap_dir.is_dir():
            continue
        for f in sorted(snap_dir.glob("videos_*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            product_id = data.get("product_id")
            for v in data.get("videos", []):
                video_id = v.get("video_id")
                published_at = v.get("video_meta", {}).get("published_at")
                if not video_id or published_at is None or video_id in seen:
                    continue
                dt = datetime.fromtimestamp(published_at, tz=ET)
                hour_start, hour_end = _hour_window(dt.hour)
                seen[video_id] = {
                    "video_id": video_id,
                    "product_id": product_id,
                    "is_ad": bool(v.get("traffic_flags", {}).get("is_ad", False)),
                    "units": v.get("product_contribution", {}).get("window_units_sold", 0) or 0,
                    "weekday": dt.weekday(),
                    "hour_start": hour_start,
                    "hour_end": hour_end,
                }
    return list(seen.values())


MIN_WINDOW_SAMPLE = 3


def _rank_window(records: list[dict]) -> dict | None:
    by_window: dict[tuple[int, int], list[int]] = defaultdict(list)
    for r in records:
        by_window[(r["hour_start"], r["hour_end"])].append(r["units"])
    if not by_window:
        return None
    # A window with only 1-2 videos can't be trusted no matter how high its
    # median -- a single viral 4 AM video would otherwise "win" over a
    # consistent noon window with a dozen median-performing videos. Prefer
    # windows with at least MIN_WINDOW_SAMPLE videos; only fall back to a
    # thin window if literally nothing clears that bar.
    qualifying = {k: v for k, v in by_window.items() if len(v) >= MIN_WINDOW_SAMPLE}
    pool = qualifying or by_window
    (hour_start, hour_end), units = max(pool.items(), key=lambda kv: median(kv[1]))
    return {"hour_start": hour_start, "hour_end": hour_end, "sample_size": len(units)}


def _rank_weekdays(records: list[dict], top_n: int = 2) -> list[int]:
    by_day: dict[int, list[int]] = defaultdict(list)
    for r in records:
        by_day[r["weekday"]].append(r["units"])
    ranked = sorted(by_day.items(), key=lambda kv: median(kv[1]), reverse=True)
    return [day for day, _ in ranked[:top_n]]


def _pick_level(levels: list[tuple[str, list[dict], int]]) -> tuple[str | None, list[dict], bool]:
    """Returns the first level with enough records, preferring its
    organic-only subset once that subset alone clears MIN_ORGANIC_VIDEOS."""
    for level_name, records, min_n in levels:
        if len(records) < min_n:
            continue
        organic = [r for r in records if not r["is_ad"]]
        if len(organic) >= MIN_ORGANIC_VIDEOS:
            return level_name, organic, True
        return level_name, records, False
    return None, [], False


def best_video_time(
    product_id: str,
    category: str,
    group: str,
    all_records: list[dict],
    product_id_to_category: dict[str, str],
    product_id_to_group: dict[str, str],
) -> dict | None:
    """Never guesses from fewer than MIN_PRODUCT_VIDEOS/MIN_POOL_VIDEOS
    records -- returns None (the caller falls back to a generic message)
    only when there isn't a single video anywhere in the pool."""
    by_product = [r for r in all_records if r["product_id"] == product_id]
    by_category = [r for r in all_records if product_id_to_category.get(r["product_id"]) == category]
    by_group = [r for r in all_records if product_id_to_group.get(r["product_id"]) == group]
    levels = [
        ("product", by_product, MIN_PRODUCT_VIDEOS),
        ("category", by_category, MIN_POOL_VIDEOS),
        ("group", by_group, MIN_POOL_VIDEOS),
        ("all", all_records, MIN_POOL_VIDEOS),
    ]
    level_name, records, used_organic = _pick_level(levels)
    if level_name is None:
        # nothing clears any level's minimum -- fall back to whatever pool
        # has the most data at all, so a brand-new category still gets a
        # best-effort answer instead of nothing.
        non_empty = [(name, recs) for name, recs, _ in levels if recs]
        if not non_empty:
            return None
        level_name, records = max(non_empty, key=lambda nr: len(nr[1]))
        used_organic = False

    window = _rank_window(records)
    if window is None:
        return None
    return {
        "basis_level": level_name,
        "sample_size": len(records),
        "used_organic_only": used_organic,
        "hour_start": window["hour_start"],
        "hour_end": window["hour_end"],
        "best_weekdays": _rank_weekdays(records),
    }


def load_live_records(snapshots_dir: Path, l1_category_id: int) -> list[dict]:
    """Part C7b: pools every data/snapshots/*/live_<l1_id>_p*.json page for
    one L1 category, deduped by room_id. Each record matches the shape
    best_time_for_pool expects: is_ad is always False (lives have no ad
    concept the way videos do -- traffic_flags doesn't exist in
    live_search's response), units/weekday/hour_start/hour_end from
    performance_summary/live.started_at."""
    seen: dict[str, dict] = {}
    if not snapshots_dir.exists():
        return []
    for snap_dir in sorted(snapshots_dir.glob("*")):
        if not snap_dir.is_dir():
            continue
        for f in sorted(snap_dir.glob(f"live_{l1_category_id}_p*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            for entry in data.get("list", []):
                live = entry.get("live", {})
                room_id = live.get("room_id")
                started_at = live.get("started_at")
                if not room_id or started_at is None or room_id in seen:
                    continue
                dt = datetime.fromtimestamp(started_at, tz=ET)
                hour_start, hour_end = _hour_window(dt.hour)
                seen[room_id] = {
                    "room_id": room_id,
                    "is_ad": False,
                    "units": entry.get("performance_summary", {}).get("live_units_sold", 0) or 0,
                    "duration_seconds": live.get("duration_seconds", 0) or 0,
                    "weekday": dt.weekday(),
                    "hour_start": hour_start,
                    "hour_end": hour_end,
                }
    return list(seen.values())


def heat_grid_cells(records: list[dict]) -> list[dict]:
    """Part B Horarios rebuild (2026-10-16): one cell per (weekday,
    hour_start) 2-hour bucket that has at least one live, each with the
    MEDIAN units sold in that slot (not mean -- one viral live shouldn't
    make a slot look better than it typically is, same reasoning as
    _rank_window's own median) and how many lives that median is based on.
    Pure/UI-agnostic: the frontend decides shading/highlighting from this.
    `records` is load_live_records's own output shape (weekday/hour_start/
    units already computed)."""
    buckets: dict[tuple[int, int], list[int]] = {}
    for r in records:
        buckets.setdefault((r["weekday"], r["hour_start"]), []).append(r["units"])
    return [
        {
            "weekday": weekday,
            "hour_start": hour_start,
            "hour_end": hour_start + 2,
            "median_units": median(units),
            "sample_size": len(units),
        }
        for (weekday, hour_start), units in buckets.items()
    ]


def top_lives_for_l1(snapshots_dir: Path, l1_category_id: int, now: datetime, within_days: int = 28, limit: int = 10) -> list[dict]:
    """Part 7 "En vivo" (2026-10-16): the top-selling lives in one L1
    category over the last `within_days` days, for the "top-selling lives"
    list -- separate from load_live_records above, which drops viewer
    count/title/timestamp to keep only what the best-time ranking needs.
    Reuses the same raw snapshot files and room_id dedup, zero FastMoss
    calls, sorted by units sold (then GMV) descending."""
    seen: dict[str, dict] = {}
    if not snapshots_dir.exists():
        return []
    cutoff = now.timestamp() - within_days * 86_400
    for snap_dir in sorted(snapshots_dir.glob("*")):
        if not snap_dir.is_dir():
            continue
        for f in sorted(snap_dir.glob(f"live_{l1_category_id}_p*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            for entry in data.get("list", []):
                live = entry.get("live", {})
                room_id = live.get("room_id")
                started_at = live.get("started_at")
                if not room_id or started_at is None or room_id in seen or started_at < cutoff:
                    continue
                perf = entry.get("performance_summary", {})
                creator = entry.get("creator", {})
                seen[room_id] = {
                    "room_id": room_id,
                    "title": live.get("title") or "",
                    "creator_handle": creator.get("creator_handle") or "",
                    "started_at": datetime.fromtimestamp(started_at, tz=ET).isoformat(),
                    "duration_minutes": round((live.get("duration_seconds") or 0) / 60),
                    "viewer_count": perf.get("total_viewer_count", 0) or 0,
                    "units_sold": perf.get("live_units_sold", 0) or 0,
                    "gmv": perf.get("live_gmv", 0.0) or 0.0,
                }
    ranked = sorted(seen.values(), key=lambda r: (r["units_sold"], r["gmv"]), reverse=True)
    return ranked[:limit]


def best_live_time_for_l1(records: list[dict]) -> dict | None:
    """Same median-ranked-window logic as best_time_for_pool, plus the
    typical length of lives that sell (median duration) -- Part C7b asks
    for both: the best window and "los lives que venden duran ~60-90 min"."""
    result = best_time_for_pool(records)
    if result is None:
        return None
    durations = [r["duration_seconds"] for r in records if r.get("duration_seconds")]
    result["median_duration_minutes"] = round(median(durations) / 60) if durations else None
    return result


def best_time_for_pool(records: list[dict]) -> dict | None:
    """Part C7c: the Mas -> "Mejores horas" page shows one breakdown per
    category/group, not per product -- this is the same organic-preference,
    median-ranked-window logic as best_video_time, just without the
    product/category/group fallback ladder (the caller already picked
    which pool of records to summarize)."""
    if not records:
        return None
    organic = [r for r in records if not r["is_ad"]]
    used_organic = len(organic) >= MIN_ORGANIC_VIDEOS
    pool = organic if used_organic else records
    window = _rank_window(pool)
    if window is None:
        return None
    return {
        "sample_size": len(pool),
        "used_organic_only": used_organic,
        "hour_start": window["hour_start"],
        "hour_end": window["hour_end"],
        "best_weekdays": _rank_weekdays(pool),
    }
