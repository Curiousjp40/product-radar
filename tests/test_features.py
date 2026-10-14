import math

import pytest

from engine.features import (
    acceleration,
    demand,
    lead_raw,
    momentum,
    momentum_multiplier,
    rank_delta,
    slope_log1p,
    wow,
)


def test_demand_is_log1p():
    assert demand(0) == 0.0
    assert abs(demand(999) - math.log1p(999)) < 1e-9


def test_demand_clamps_negative_units_to_zero():
    assert demand(-5) == 0.0


def test_slope_log1p_flat_series_is_zero():
    assert abs(slope_log1p([10, 10, 10, 10, 10])) < 1e-9


def test_slope_log1p_positive_for_growing_series():
    assert slope_log1p([10, 20, 40, 80, 160]) > 0


def test_slope_log1p_negative_for_shrinking_series():
    assert slope_log1p([160, 80, 40, 20, 10]) < 0


def test_acceleration_needs_14_days():
    with pytest.raises(ValueError):
        acceleration([1] * 10)


def test_acceleration_detects_speeding_up():
    # flat for the first 7 days, then accelerating growth for the last 7
    previous_7 = [10, 10, 10, 10, 10, 10, 10]
    last_7 = [10, 15, 22, 33, 50, 75, 110]
    accel = acceleration(previous_7 + last_7)
    assert accel > 0


def test_wow_uses_floor_of_50():
    # prev=10 but floor is 50, so denominator is 50 not 10
    assert wow(units_7d_now=60, units_7d_prev=10) == pytest.approx((60 - 10) / 50)


def test_wow_falls_back_to_growth_rate_when_prev_missing():
    assert wow(units_7d_now=100, units_7d_prev=None, growth_rate_fallback=0.25) == 0.25


def test_wow_raises_without_prev_or_fallback():
    with pytest.raises(ValueError):
        wow(units_7d_now=100, units_7d_prev=None)


def test_rank_delta_positive_when_climbing():
    assert rank_delta(rank_prev=50, rank_now=10) == 40
    assert rank_delta(rank_prev=10, rank_now=50) == -40
    assert rank_delta(None, 10) is None


def test_lead_raw_sums_both_deltas():
    lead = lead_raw(creator_count_last7=12, creator_count_prior7=8, video_count_last7=30, video_count_prior7=20)
    assert lead == pytest.approx((12 - 8) + (30 - 20))


def test_lead_raw_negative_when_shrinking():
    assert lead_raw(5, 10, 15, 25) < 0


def test_momentum_weighted_sum_with_lead():
    m = momentum(
        z_wow=1.0,
        z_slope14=2.0,
        z_accel=0.5,
        z_lead=1.5,
        slope14_weight=0.35,
        wow_weight=0.20,
        accel_weight=0.15,
        lead_weight=0.30,
    )
    assert m == pytest.approx(0.35 * 2.0 + 0.20 * 1.0 + 0.15 * 0.5 + 0.30 * 1.5)


def test_momentum_missing_lead_contributes_zero_not_dropped():
    with_lead = momentum(z_wow=1.0, z_slope14=1.0, z_accel=1.0, z_lead=0.0)
    without_lead = momentum(z_wow=1.0, z_slope14=1.0, z_accel=1.0, z_lead=None)
    assert with_lead == pytest.approx(without_lead)


def test_momentum_falls_back_to_wow_only():
    assert momentum(z_wow=1.23, z_slope14=None, z_accel=None) == 1.23


def test_momentum_multiplier_clamped():
    assert momentum_multiplier(slope14=0) == 1.0
    assert momentum_multiplier(slope14=1.0) == 2.0  # clamped from 1+7*1=8
    assert momentum_multiplier(slope14=-1.0) == 0.5  # clamped from 1-7=-6
