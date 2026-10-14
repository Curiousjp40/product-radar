"""Creator-specific fit, spec section 6.6.

Target-category boost and "not for me" feedback are added on top of the
0.6/0.25/0.15 weighted blend (the spec lists them as separate steps 1-3 and
only folds category_prior/price_fit/audience_fit into the formula in step 4),
not blended into it.
"""

from __future__ import annotations

import math

from engine.stats import clamp, jaccard, shrink, tokenize_title


def category_prior_raw(views_c: float, her_gpm_c: float, pooled_gpm_c: float, k: float = 200_000) -> float:
    """gpm_c, section 6.6 step 1 (before normalization across categories)."""
    return shrink(local_value=her_gpm_c, local_weight=views_c, pooled_value=pooled_gpm_c, k=k)


def normalize_priors(raw_priors: dict[str, float]) -> dict[str, float]:
    """Min-max scale raw category priors to 0..1 across categories.

    All-equal input (including a single category) maps to 0.5 everywhere --
    there's no spread to normalize against.
    """
    if not raw_priors:
        return {}
    values = list(raw_priors.values())
    lo, hi = min(values), max(values)
    if hi == lo:
        return {k: 0.5 for k in raw_priors}
    return {k: (v - lo) / (hi - lo) for k, v in raw_priors.items()}


def price_fit_gaussian(price: float, log_mean: float, sigma: float = 0.5) -> float:
    """Gaussian "closeness" of `price` to a creator's typical log price, section 6.6 step 2."""
    if price <= 0:
        return 0.0
    z = (math.log(price) - log_mean) / sigma
    return math.exp(-0.5 * z * z)


def blended_price_fit(
    price: float,
    creator_log_mean: float,
    n_tracked_videos: int,
    sweet_spot_usd: tuple[float, float] = (25, 55),
    sigma: float = 0.5,
    min_tracked_videos: int = 30,
) -> float:
    """Blend the creator's own price-fit toward the $25-55 sweet spot until she
    has `min_tracked_videos` tracked (section 6.6 step 2)."""
    own = price_fit_gaussian(price, creator_log_mean, sigma)
    sweet_log_mean = math.log(math.sqrt(sweet_spot_usd[0] * sweet_spot_usd[1]))
    sweet = price_fit_gaussian(price, sweet_log_mean, sigma)
    weight_sweet = clamp((min_tracked_videos - n_tracked_videos) / min_tracked_videos, 0.0, 1.0)
    return weight_sweet * sweet + (1 - weight_sweet) * own


def target_category_boost(category: str, target_categories: list[str], boost: float = 0.15) -> float:
    return boost if category in target_categories else 0.0


def is_excluded(
    category: str,
    shop_name: str,
    title: str,
    excluded_categories: list[str],
    excluded_brands: list[str],
    excluded_keywords: list[str],
) -> bool:
    if category in excluded_categories:
        return True
    if shop_name in excluded_brands:
        return True
    title_lower = title.lower()
    return any(kw.lower() in title_lower for kw in excluded_keywords)


def is_similar_product(
    category_l2_a: str | None,
    title_a: str,
    category_l2_b: str | None,
    title_b: str,
    title_jaccard_threshold: float = 0.3,
) -> bool:
    """"Same L2 category or shared title keywords", section 6.6 step 3."""
    if category_l2_a and category_l2_b and category_l2_a == category_l2_b:
        return True
    return jaccard(tokenize_title(title_a), tokenize_title(title_b)) >= title_jaccard_threshold


def feedback_penalty(is_similar: bool, weeks_since_feedback: int, window_weeks: int = 8, penalty: float = 0.1) -> float:
    if is_similar and weeks_since_feedback <= window_weeks:
        return penalty
    return 0.0


def fit_score(
    category_prior_norm: float,
    price_fit: float,
    audience_fit: float = 0.5,
    target_boost: float = 0.0,
    feedback_penalty_value: float = 0.0,
    category_prior_weight: float = 0.6,
    price_fit_weight: float = 0.25,
    audience_fit_weight: float = 0.15,
) -> float:
    """F, section 6.6 step 4, plus the boost/penalty from steps 1-3."""
    base = (
        category_prior_weight * category_prior_norm
        + price_fit_weight * price_fit
        + audience_fit_weight * audience_fit
    )
    return base + target_boost - feedback_penalty_value
