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


def season_ending_factor(today: date, film_end: date, warning_days: int = 14, floor: float = 0.3) -> float:
    """Multiplier (0..1) that downweights `event_term` as a film window's end
    approaches, added 2026-10-15 after the first real run kept recommending
    Halloween costumes at full strength with the window about to close.
    1.0 when film_end is more than `warning_days` away; ramps linearly down
    to `floor` (not all the way to 0 -- it's still technically fair game)
    as `today` reaches `film_end`; 0 once the window has actually closed."""
    days_to_end = (film_end - today).days
    if days_to_end < 0:
        return 0.0
    if days_to_end > warning_days:
        return 1.0
    return floor + (1 - floor) * (days_to_end / warning_days)


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


def boosted_category_multiplier(category: str, boosted_categories: list[str], boost: float = 1.3) -> float:
    """Extra lift for a season's explicitly favored categories (seasons.yaml's
    `boosted_categories`, e.g. Black Friday boosting shapewear/winter
    clothing/gifts) -- 1.0 (no change) if the category isn't boosted."""
    return boost if category in boosted_categories else 1.0


def title_matches_event_keywords(title: str, keywords: list[str]) -> bool:
    """Case-insensitive substring match, added 2026-10-15 for per-event pick
    caps (config/seasons.yaml's `title_keywords`, e.g. Halloween's "costume").

    This is deliberately separate from the category-based event matching
    above: real FastMoss category feeds surface Halloween costumes under
    "womens_clothing" (a generic clothing category), not a seasonal one, and
    once Black Friday's own boost outscores Halloween's (which is being
    actively downweighted as its window closes), category-based matching
    alone can never attribute those products to Halloween -- so a "max 1
    Halloween pick" cap on the category-matched event would be inert right
    when it matters most. Title keywords catch the product itself, regardless
    of which event scores highest for it."""
    lowered = title.lower()
    return any(kw.lower() in lowered for kw in keywords)
