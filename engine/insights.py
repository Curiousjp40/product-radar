"""Content insights computed from creators' own videos, spec section 8.
No FastMoss data needed -- everything here runs on CreatorVideo rows (seeded
from data/seed/creator_history.json, later refreshed from FastMoss in Phase 5).

`summarize_creator` produces the section-2.1-shaped totals for one creator;
the dashboard's "benchmark vs Ari" view (section 8.6) is just two calls to it
side by side, so there's no separate benchmark function here.
"""

from __future__ import annotations

from collections.abc import Sequence

import pandas as pd

from engine.models import CreatorVideo

LengthBucket = str  # "<=12s" | "13-20s" | "21-30s" | "31s+"


def length_bucket(duration_s: int) -> LengthBucket:
    if duration_s <= 12:
        return "<=12s"
    if duration_s <= 20:
        return "13-20s"
    if duration_s <= 30:
        return "21-30s"
    return "31s+"


def _frame(videos: Sequence[CreatorVideo]) -> pd.DataFrame:
    return pd.DataFrame([v.model_dump() for v in videos])


def length_sweet_spot(videos: Sequence[CreatorVideo]) -> dict[str, dict[str, float]]:
    """GMV per video and units per 10K views by length bucket, section 8.1."""
    if not videos:
        return {}
    df = _frame(videos)
    df["bucket"] = df["duration_s"].apply(length_bucket)
    out: dict[str, dict[str, float]] = {}
    for bucket, group in df.groupby("bucket"):
        total_views = group["views"].sum()
        out[bucket] = {
            "video_count": int(len(group)),
            "gmv_per_video": float(group["gmv"].mean()),
            "units_per_10k_views": float(group["units"].sum() / total_views * 10_000) if total_views else 0.0,
        }
    return out


def _spearman(a: pd.Series, b: pd.Series) -> float:
    """Spearman rank correlation without scipy: rank both series, then Pearson
    on the ranks (pandas' own method="spearman" needs scipy for the p-value
    machinery it doesn't even return here)."""
    return float(a.rank().corr(b.rank(), method="pearson"))


def reach_vs_engagement(videos: Sequence[CreatorVideo]) -> dict[str, float | None]:
    """Spearman rank correlation of views vs GMV, and interaction rate vs GMV,
    section 8.2 ("views drive sales; likes do not")."""
    if len(videos) < 2:
        return {"views_gmv_corr": None, "interaction_rate_gmv_corr": None}
    df = _frame(videos)
    views_corr = _spearman(df["views"], df["gmv"])
    interaction_corr = None
    if df["interaction_rate_pct"].notna().sum() >= 2:
        interaction_corr = _spearman(df["interaction_rate_pct"], df["gmv"])
    interaction_missing = interaction_corr is None or pd.isna(interaction_corr)
    return {
        "views_gmv_corr": None if pd.isna(views_corr) else views_corr,
        "interaction_rate_gmv_corr": None if interaction_missing else interaction_corr,
    }


def hit_tracker(videos: Sequence[CreatorVideo]) -> dict[str, float]:
    """Share of GMV from the top 1 / top 5 videos, plus posting cadence,
    section 8.3."""
    if not videos:
        return {"gmv_top1_share": 0.0, "gmv_top5_share": 0.0, "videos_per_week": 0.0}
    df = _frame(videos).sort_values("gmv", ascending=False)
    total_gmv = df["gmv"].sum()
    top1_share = float(df["gmv"].iloc[0] / total_gmv) if total_gmv else 0.0
    top5_share = float(df["gmv"].iloc[:5].sum() / total_gmv) if total_gmv else 0.0
    span_days = (pd.to_datetime(df["published_at"]).max() - pd.to_datetime(df["published_at"]).min()).days
    weeks = max(span_days / 7, 1.0)
    return {
        "gmv_top1_share": top1_share,
        "gmv_top5_share": top5_share,
        "videos_per_week": float(len(df) / weeks),
    }


def format_tag_breakdown(videos: Sequence[CreatorVideo]) -> dict[str, dict[str, float]]:
    """Per-tag aggregates (section 8.5): `is_reply` is always tagged "reply";
    anything else present in `format_tags` passes through as-is (try-on /
    before-after / unboxing detection is caption-pattern + manual-tag work the
    spec defers to the pipeline, not something to guess at here)."""
    tagged: dict[str, list[CreatorVideo]] = {}
    for v in videos:
        tags = set(v.format_tags)
        if v.is_reply:
            tags.add("reply")
        for tag in tags:
            tagged.setdefault(tag, []).append(v)
    out: dict[str, dict[str, float]] = {}
    for tag, tag_videos in tagged.items():
        df = _frame(tag_videos)
        total_views = df["views"].sum()
        out[tag] = {
            "video_count": int(len(df)),
            "gmv_per_video": float(df["gmv"].mean()),
            "units_per_10k_views": float(df["units"].sum() / total_views * 10_000) if total_views else 0.0,
        }
    return out


def summarize_creator(videos: Sequence[CreatorVideo]) -> dict[str, float]:
    """Section-2.1-shaped totals for one creator, used for benchmarking (8.6)."""
    if not videos:
        return {
            "video_count": 0, "gmv": 0.0, "units": 0, "views": 0,
            "median_views_per_video": 0.0, "median_gmv_per_video": 0.0,
            "avg_price_per_unit": 0.0, "units_per_10k_views": 0.0,
            "gmv_per_1k_views": 0.0, "gmv_top1_share": 0.0, "gmv_top5_share": 0.0,
        }
    df = _frame(videos)
    total_gmv = float(df["gmv"].sum())
    total_units = int(df["units"].sum())
    total_views = int(df["views"].sum())
    hits = hit_tracker(videos)
    return {
        "video_count": int(len(df)),
        "gmv": total_gmv,
        "units": total_units,
        "views": total_views,
        "median_views_per_video": float(df["views"].median()),
        "median_gmv_per_video": float(df["gmv"].median()),
        "avg_price_per_unit": total_gmv / total_units if total_units else 0.0,
        "units_per_10k_views": total_units / total_views * 10_000 if total_views else 0.0,
        "gmv_per_1k_views": total_gmv / total_views * 1_000 if total_views else 0.0,
        "gmv_top1_share": hits["gmv_top1_share"],
        "gmv_top5_share": hits["gmv_top5_share"],
    }
