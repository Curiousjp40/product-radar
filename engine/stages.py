"""Lifecycle stage classifier, spec section 6.3.

Rules are checked in this order: Declining, Emerging, Rising, Peak, Evergreen.
Declining goes first because it is the actionable "stop/swap" signal and should
win any overlap (e.g. a product that is both losing rank and technically still
"in tracked lists 6 of 8 weeks").

If nothing matches, the fallback is "new_to_radar" (added 2026-10-15), not
Evergreen: the first real run labeled all 9 picks "evergreen" off exactly one
week of history, which is backwards -- Evergreen specifically means "tracked
6 of the last 8 weeks" (see the dedicated rule below), so a product that
hasn't earned that yet should say so plainly rather than borrow the
"reliable filler" label. (One imprecise edge case: a product tracked 6+ weeks
whose slope is too noisy to hit any rule also falls here, even though it
isn't literally new -- there's no cleaner single label for that today.)
"""

from __future__ import annotations

from typing import Literal

Stage = Literal["emerging", "rising", "peak", "evergreen", "declining", "new_to_radar"]


def classify_stage(
    *,
    units_7d: float,
    category_median_units_7d: float,
    category_units_7d_p75: float,
    slope14: float,
    creator_count: int,
    category_creator_count_p40: float,
    saturation: float,
    weeks_tracked_last_8: int,
    recent_declining_runs: int,
    rank_delta: int | None,
    emerging_slope_min: float = 0.05,
    rising_slope_min: float = 0.02,
    peak_slope_abs_max: float = 0.02,
    evergreen_weeks_tracked_min: int = 6,
    evergreen_slope_abs_max: float = 0.02,
    declining_slope_max: float = -0.02,
    declining_consecutive_runs: int = 2,
    declining_rank_drop_min: int = 20,
) -> Stage:
    rank_fell = rank_delta is not None and rank_delta <= -declining_rank_drop_min
    if (slope14 < declining_slope_max and recent_declining_runs >= declining_consecutive_runs) or rank_fell:
        return "declining"

    if (
        units_7d < category_median_units_7d
        and slope14 > emerging_slope_min
        and creator_count < category_creator_count_p40
    ):
        return "emerging"

    if slope14 > rising_slope_min and units_7d >= category_median_units_7d:
        return "rising"

    if (
        abs(slope14) <= peak_slope_abs_max
        and units_7d >= category_units_7d_p75
        and saturation > 0
    ):
        return "peak"

    if weeks_tracked_last_8 >= evergreen_weeks_tracked_min and abs(slope14) < evergreen_slope_abs_max:
        return "evergreen"

    return "new_to_radar"
