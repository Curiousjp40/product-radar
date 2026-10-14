"""Demand and momentum, spec section 6.1-6.2.

All cross-sectional z-scoring (z(slope14), z(wow), z(accel)) happens upstream,
over the full weekly candidate set, via engine.stats.grouped_robust_z -- these
functions take the resulting z-scores as plain floats so they stay pure and
trivially unit-testable.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from engine.stats import clamp


def demand(units_7d: float) -> float:
    """D = log1p(units_7d), section 6.1."""
    return math.log1p(max(units_7d, 0))


def slope_log1p(daily_units: Sequence[float]) -> float:
    """Least-squares slope of log1p(daily units) vs day index.

    0.05 means about +5%/day (section 6.2). Needs at least 2 points.
    """
    if len(daily_units) < 2:
        return 0.0
    y = np.log1p(np.clip(np.asarray(daily_units, dtype=float), 0, None))
    x = np.arange(len(y), dtype=float)
    slope, _intercept = np.polyfit(x, y, 1)
    return float(slope)


def acceleration(daily_units_last_14: Sequence[float]) -> float:
    """slope(last 7 days) - slope(previous 7 days). Needs exactly 14 values,
    oldest first."""
    if len(daily_units_last_14) < 14:
        raise ValueError("acceleration needs 14 days of daily units (oldest first)")
    previous_7 = daily_units_last_14[:7]
    last_7 = daily_units_last_14[7:14]
    return slope_log1p(last_7) - slope_log1p(previous_7)


def wow(units_7d_now: float, units_7d_prev: float | None, growth_rate_fallback: float | None = None) -> float:
    """(now - prev) / max(prev, 50), section 6.2. Falls back to FastMoss's own
    growth rate if last week's snapshot is missing."""
    if units_7d_prev is None:
        if growth_rate_fallback is not None:
            return growth_rate_fallback
        raise ValueError("units_7d_prev is missing and no growth_rate_fallback was given")
    return (units_7d_now - units_7d_prev) / max(units_7d_prev, 50)


def rank_delta(rank_prev: int | None, rank_now: int | None) -> int | None:
    """Positive = climbing (section 6.2)."""
    if rank_prev is None or rank_now is None:
        return None
    return rank_prev - rank_now


def lead_raw(
    creator_count_last7: float,
    creator_count_prior7: float,
    video_count_last7: float,
    video_count_prior7: float,
) -> float:
    """Raw (pre-z-score) leading-indicator signal, section 6.2: growth in
    creators plus growth in videos promoting the product, last 7 days vs the
    prior 7 (from FastMoss's product_creator_analysis + product_video_list).
    FastMoss's own guidance is that creator/video increments lead GMV by
    about a week, making this the earliest rise/peak signal available."""
    return (creator_count_last7 - creator_count_prior7) + (video_count_last7 - video_count_prior7)


def momentum(
    z_wow: float,
    z_slope14: float | None = None,
    z_accel: float | None = None,
    z_lead: float | None = None,
    slope14_weight: float = 0.35,
    wow_weight: float = 0.20,
    accel_weight: float = 0.15,
    lead_weight: float = 0.30,
) -> float:
    """M, section 6.2. Falls back to `z_wow` alone when daily series weren't
    fetched for this product (z_slope14/z_accel unavailable) -- that's a
    separate budget gate from `z_lead`'s own source calls, so a missing
    `z_lead` alone contributes 0 (neutral) rather than dropping out entirely."""
    if z_slope14 is None or z_accel is None:
        return z_wow
    lead = z_lead if z_lead is not None else 0.0
    return slope14_weight * z_slope14 + wow_weight * z_wow + accel_weight * z_accel + lead_weight * lead


def momentum_multiplier(slope14: float, coef: float = 7, lo: float = 0.5, hi: float = 2.0) -> float:
    """M_mult, section 6.11."""
    return clamp(1 + coef * slope14, lo, hi)
