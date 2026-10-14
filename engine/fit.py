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


def creator_avg_category_gpm(category_gpm: dict[str, float], category_views: dict[str, float]) -> float:
    """Her own views-weighted average GMV-per-1,000-views across categories
    (config/creators.yaml's `category_gpm_per_1k_views` and `category_views`),
    added 2026-10-15 as the bar a category_fit reason has to clear: citing a
    below-average number as if it were a selling point undersells the pick
    rather than supporting it."""
    total_views = sum(category_views.get(cat, 0.0) for cat in category_gpm)
    if total_views == 0:
        return sum(category_gpm.values()) / len(category_gpm) if category_gpm else 0.0
    return sum(category_gpm[cat] * category_views.get(cat, 0.0) for cat in category_gpm) / total_views


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


_MALE_KEYWORDS = {"men's", "mens", "for him", "man", "male", "husband", "boyfriend", "dad", "father", "menswear"}
_GIFT_KEYWORDS = {"gift", "present", "fathers day", "father's day", "valentine", "anniversary"}


def demographic_match_score(buyer_male_share_pct: float, audience_male_share_pct: float) -> float:
    """How well a product's buyer gender mix matches the creator's own
    FastMoss audience gender mix (section 6.6 audience-fit extension, added
    2026-10-14). Both are percent numbers (0-100), matching FastMoss's own
    percent-integer convention. 1.0 = identical mix, 0.0 = opposite."""
    return clamp(1 - abs(buyer_male_share_pct - audience_male_share_pct) / 100, 0.0, 1.0)


def demographic_fit_heuristic(title: str, category_name: str = "", boost: float = 0.65, neutral: float = 0.5) -> float:
    """Fallback audience-demographic signal when FastMoss doesn't return
    buyer demographics for a product (checked via product_overview; see
    docs/field_map.md): boost products that read as sold to men or bought as
    gifts, since the creator's own FastMoss audience skews male. Keyword-based
    and deliberately crude -- a real buyer-demographics field always wins."""
    text = f"{title} {category_name}".lower()
    if any(kw in text for kw in _MALE_KEYWORDS) or any(kw in text for kw in _GIFT_KEYWORDS):
        return boost
    return neutral


def audience_fit(
    spanish_component: float | None,
    demographic_component: float | None,
    spanish_weight: float = 0.5,
    demographic_weight: float = 0.5,
) -> float:
    """audience_fit, section 6.6 step 4 (`F`'s third input), extended with a
    demographic-fit term added alongside the Spanish gap (section 6.8) --
    each defaults to neutral 0.5 when not computed, matching the spec's own
    "or 0.5 if not computed" convention for this input."""
    spanish = spanish_component if spanish_component is not None else 0.5
    demographic = demographic_component if demographic_component is not None else 0.5
    return spanish_weight * spanish + demographic_weight * demographic


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
