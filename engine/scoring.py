"""Money per sale, saturation/opportunity, risk, composite score, and expected
value -- spec sections 6.4, 6.5, 6.9, 6.10, 6.11.

Like engine.features, the z-scored inputs (z_D, z_logE, z_F, z_G, z_saturation,
z_demand_per_creator) are computed upstream over the weekly candidate set via
engine.stats.grouped_robust_z and passed in as plain floats.
"""

from __future__ import annotations

import math

from engine.stats import clamp, sigmoid


def earnings_per_sale(price: float, commission_rate: float) -> float:
    """E = price * commission_rate, section 6.4."""
    return price * commission_rate


def demand_per_creator(units_7d: float, creator_count: int) -> float:
    """section 6.5."""
    return units_7d / max(creator_count, 1)


def saturation(creator_count_growth: float, units_growth: float) -> float:
    """Positive means creators are piling in faster than buyers, section 6.5."""
    return creator_count_growth - units_growth


def opportunity(z_log_demand_per_creator: float, z_saturation: float, saturation_weight: float = 0.5) -> float:
    """O, section 6.5."""
    return z_log_demand_per_creator - saturation_weight * z_saturation


def risk_penalty(
    earnings_per_sale_usd: float,
    price_cv_4wk: float | None,
    rating: float | None,
    creator_count_percentile: float | None,
    unit_price_usd: float,
    commission_rate_pct: float,
    low_earnings_threshold: float = 1.50,
    low_earnings_penalty: float = 1.5,
    price_cv_threshold: float = 0.25,
    price_cv_penalty: float = 0.5,
    low_rating_threshold: float = 4.0,
    low_rating_penalty: float = 1.0,
    high_creator_pct_threshold: float = 0.95,
    high_creator_pct_penalty: float = 0.5,
    low_price_threshold_usd: float = 10,
    low_price_penalty: float = 0.5,
    low_price_commission_exempt_pct: float = 20,
    ads_share_pct: float | None = None,
    high_ads_share_pct_threshold: float = 60,
    high_ads_share_penalty: float = 0.5,
) -> float:
    """R, section 6.9. Assumes delisted products are already filtered out
    upstream (the spec says delisted products are "excluded", not penalized).
    `ads_share_pct` (from FastMoss's product_overview ad/organic split) is a
    percent number like `commission_rate_pct`, not a 0-1 fraction -- a
    product selling mostly through paid ads is harder for an affiliate
    creator to win organically."""
    r = 0.0
    if earnings_per_sale_usd < low_earnings_threshold:
        r += low_earnings_penalty
    if price_cv_4wk is not None and price_cv_4wk > price_cv_threshold:
        r += price_cv_penalty
    if rating is not None and rating < low_rating_threshold:
        r += low_rating_penalty
    if creator_count_percentile is not None and creator_count_percentile >= high_creator_pct_threshold:
        r += high_creator_pct_penalty
    if unit_price_usd < low_price_threshold_usd and commission_rate_pct < low_price_commission_exempt_pct:
        r += low_price_penalty
    if ads_share_pct is not None and ads_share_pct > high_ads_share_pct_threshold:
        r += high_ads_share_penalty
    return r


def composite_score(
    z_demand: float,
    momentum: float,
    z_log_earnings: float,
    opportunity_value: float,
    z_fit: float,
    seasonality_value: float,
    z_spanish_gap: float,
    risk: float,
    demand_weight: float = 0.10,
    momentum_weight: float = 0.25,
    log_earnings_weight: float = 0.20,
    opportunity_weight: float = 0.15,
    fit_weight: float = 0.15,
    seasonality_weight: float = 0.10,
    spanish_gap_weight: float = 0.05,
    risk_weight: float = 0.40,
) -> int:
    """score (0-100), section 6.10."""
    raw = (
        demand_weight * z_demand
        + momentum_weight * momentum
        + log_earnings_weight * z_log_earnings
        + opportunity_weight * opportunity_value
        + fit_weight * z_fit
        + seasonality_weight * seasonality_value
        + spanish_gap_weight * z_spanish_gap
        - risk_weight * risk
    )
    return round(100 * sigmoid(raw))


def spanish_gap(z_demand: float, spanish_share: float) -> float:
    """G = z(D) * (1 - spanish_share), section 6.8."""
    return z_demand * (1 - spanish_share)


def saturation_multiplier(z_saturation: float, coef: float = 0.3, lo: float = 0.6, hi: float = 1.2) -> float:
    """Sat_mult, section 6.11."""
    return clamp(1 - coef * z_saturation, lo, hi)


def expected_value(
    views: float,
    cvr_per_10k_views: float,
    price: float,
    commission_rate: float,
    momentum_multiplier: float,
    saturation_multiplier: float,
) -> float:
    """EV_typical / EV_upside depending on whether `views` is V_med(c) or
    V_p90(c), section 6.11."""
    units_per_view = cvr_per_10k_views / 10_000
    return views * units_per_view * price * commission_rate * momentum_multiplier * saturation_multiplier


def log_earnings(earnings_per_sale_usd: float) -> float:
    """log(E) input to z(log E) in the composite score, section 6.10. Floors at
    a cent to avoid log(0) for a $0 earnings edge case."""
    return math.log(max(earnings_per_sale_usd, 0.01))
