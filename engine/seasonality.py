"""Event calendar + personal seasonality, spec section 6.7."""

from __future__ import annotations

from datetime import date, timedelta


def event_term(today: date, film_start: date, film_end: date, lookahead_days: int = 21) -> float:
    """"+1 if the film window overlaps the next 21 days, scaled by days remaining."

    The spec doesn't pin down exactly what "scaled by days remaining" scales
    against, so this ramps 0 -> 1 as the window's start approaches (more than
    `lookahead_days` away = 0), then holds at 1.0 for the whole open window --
    once she can film it, the signal should stay at full strength until the
    window actually closes, not fade out mid-window.
    """
    if film_end < today or film_start > today + timedelta(days=lookahead_days):
        return 0.0
    if film_start <= today <= film_end:
        return 1.0
    days_until_start = (film_start - today).days
    return max(0.0, 1 - days_until_start / lookahead_days)


def personal_term(category_month_gmv: float, total_month_gmv: float, n_categories: int, alpha: float = 1.0) -> float:
    """Her historical GMV share for this category in the coming month, Laplace-smoothed.

    `n_categories` is how many categories she has ever sold in that month (for
    the smoothing denominator); `alpha` is the smoothing strength.
    """
    denom = total_month_gmv + alpha * max(n_categories, 1)
    if denom == 0:
        return 0.0
    return (category_month_gmv + alpha) / denom


def seasonality_score(event: float, personal: float, event_weight: float = 0.6, personal_weight: float = 0.4) -> float:
    """S, section 6.7."""
    return event_weight * event + personal_weight * personal
