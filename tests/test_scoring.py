import pytest

from engine.scoring import (
    composite_score,
    demand_per_creator,
    earnings_per_sale,
    expected_value,
    log_earnings,
    opportunity,
    risk_penalty,
    saturation,
    saturation_multiplier,
    spanish_gap,
)


def test_earnings_per_sale():
    assert earnings_per_sale(price=30, commission_rate=0.15) == pytest.approx(4.5)


def test_demand_per_creator_guards_zero_creators():
    assert demand_per_creator(units_7d=100, creator_count=0) == 100


def test_saturation_positive_when_creators_outgrow_units():
    assert saturation(creator_count_growth=0.5, units_growth=0.1) == pytest.approx(0.4)


def test_opportunity_formula():
    assert opportunity(z_log_demand_per_creator=1.0, z_saturation=0.5) == pytest.approx(1.0 - 0.5 * 0.5)


def test_risk_penalty_sums_matching_components():
    r = risk_penalty(
        earnings_per_sale_usd=1.0,  # < 1.50 -> +1.5
        price_cv_4wk=0.3,  # > 0.25 -> +0.5
        rating=3.5,  # < 4.0 -> +1.0
        creator_count_percentile=0.97,  # >= 0.95 -> +0.5
        unit_price_usd=5,  # < 10 and commission < 20% -> +0.5
        commission_rate_pct=10,
    )
    assert r == pytest.approx(1.5 + 0.5 + 1.0 + 0.5 + 0.5)


def test_risk_penalty_low_price_exempt_with_high_commission():
    r = risk_penalty(
        earnings_per_sale_usd=5.0,
        price_cv_4wk=0.1,
        rating=4.5,
        creator_count_percentile=0.5,
        unit_price_usd=5,
        commission_rate_pct=25,  # >= 20% exempts the low-price penalty
    )
    assert r == 0.0


def test_risk_penalty_handles_missing_optional_signals():
    r = risk_penalty(
        earnings_per_sale_usd=5.0,
        price_cv_4wk=None,
        rating=None,
        creator_count_percentile=None,
        unit_price_usd=20,
        commission_rate_pct=10,
    )
    assert r == 0.0


def test_composite_score_in_0_100_range():
    score = composite_score(
        z_demand=1.0,
        momentum=1.0,
        z_log_earnings=1.0,
        opportunity_value=1.0,
        z_fit=1.0,
        seasonality_value=1.0,
        z_spanish_gap=1.0,
        risk=0.0,
    )
    assert 0 <= score <= 100
    assert score > 50  # all-positive inputs, no risk -> above the sigmoid midpoint


def test_composite_score_heavy_risk_pulls_score_down():
    good = composite_score(1, 1, 1, 1, 1, 1, 1, risk=0.0)
    bad = composite_score(1, 1, 1, 1, 1, 1, 1, risk=5.0)
    assert bad < good


def test_spanish_gap_formula():
    assert spanish_gap(z_demand=2.0, spanish_share=0.25) == pytest.approx(2.0 * 0.75)


def test_saturation_multiplier_clamped():
    assert saturation_multiplier(z_saturation=0) == 1.0
    assert saturation_multiplier(z_saturation=10) == 0.6
    assert saturation_multiplier(z_saturation=-10) == 1.2


def test_expected_value_formula():
    ev = expected_value(
        views=10_000,
        cvr_per_10k_views=6.17,
        price=30,
        commission_rate=0.15,
        momentum_multiplier=1.0,
        saturation_multiplier=1.0,
    )
    assert ev == pytest.approx(10_000 * (6.17 / 10_000) * 30 * 0.15)


def test_log_earnings_floors_at_near_zero():
    import math

    assert log_earnings(0) == pytest.approx(math.log(0.01))
