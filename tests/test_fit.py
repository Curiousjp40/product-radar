import math

import pytest

from engine.fit import (
    blended_price_fit,
    category_prior_raw,
    feedback_penalty,
    fit_score,
    is_excluded,
    is_similar_product,
    normalize_priors,
    price_fit_gaussian,
    target_category_boost,
)


def test_category_prior_raw_matches_shrink_formula():
    assert category_prior_raw(views_c=517_300, her_gpm_c=20.79, pooled_gpm_c=20.79, k=200_000) == pytest.approx(20.79)


def test_category_prior_raw_pulls_toward_pooled_for_low_views():
    raw = category_prior_raw(views_c=100, her_gpm_c=100, pooled_gpm_c=10, k=200_000)
    assert raw < 10.1  # almost entirely pooled


def test_normalize_priors_min_max():
    out = normalize_priors({"a": 10, "b": 20, "c": 30})
    assert out == {"a": 0.0, "b": 0.5, "c": 1.0}


def test_normalize_priors_all_equal_is_half():
    assert normalize_priors({"a": 5, "b": 5}) == {"a": 0.5, "b": 0.5}


def test_normalize_priors_empty():
    assert normalize_priors({}) == {}


def test_price_fit_gaussian_peaks_at_mean():
    log_mean = math.log(35)
    assert price_fit_gaussian(35, log_mean) == pytest.approx(1.0)
    assert price_fit_gaussian(5, log_mean) < price_fit_gaussian(30, log_mean)
    assert price_fit_gaussian(0, log_mean) == 0.0


def test_blended_price_fit_leans_on_sweet_spot_with_few_tracked_videos():
    # her own mean is far from the sweet spot; with 0 tracked videos the sweet
    # spot should dominate, so a sweet-spot price scores much better than her own mean would predict
    fit_new_creator = blended_price_fit(price=37, creator_log_mean=math.log(100), n_tracked_videos=0)
    fit_established_creator = blended_price_fit(price=37, creator_log_mean=math.log(100), n_tracked_videos=30)
    assert fit_new_creator > fit_established_creator


def test_target_category_boost():
    assert target_category_boost("shapewear", ["shapewear", "home_decor"]) == 0.15
    assert target_category_boost("beauty_hair", ["shapewear"]) == 0.0


def test_is_excluded_by_category_brand_or_keyword():
    assert is_excluded("halloween_costumes", "ShopX", "Spooky Wig", ["halloween_costumes"], [], [])
    assert is_excluded("other", "BannedShop", "Anything", [], ["BannedShop"], [])
    assert is_excluded("other", "ShopX", "Cheap Knockoff Bag", [], [], ["knockoff"])
    assert not is_excluded("shapewear", "ShopX", "BBL Shorts", ["halloween_costumes"], ["BannedShop"], ["knockoff"])


def test_is_similar_product_same_category():
    assert is_similar_product("fajas", "BBL Shorts", "fajas", "Totally Different Title")


def test_is_similar_product_shared_keywords():
    assert is_similar_product(None, "Seamless Tummy Control Shorts", None, "Seamless Tummy Control Shapewear")


def test_is_similar_product_false_when_unrelated():
    assert not is_similar_product("fajas", "BBL Shorts", "home_decor", "Ceramic Vase Set")


def test_feedback_penalty_applies_within_window():
    assert feedback_penalty(is_similar=True, weeks_since_feedback=3, window_weeks=8) == 0.1
    assert feedback_penalty(is_similar=True, weeks_since_feedback=9, window_weeks=8) == 0.0
    assert feedback_penalty(is_similar=False, weeks_since_feedback=1, window_weeks=8) == 0.0


def test_fit_score_formula():
    score = fit_score(
        category_prior_norm=0.8,
        price_fit=0.6,
        audience_fit=0.5,
        target_boost=0.15,
        feedback_penalty_value=0.1,
    )
    expected = 0.6 * 0.8 + 0.25 * 0.6 + 0.15 * 0.5 + 0.15 - 0.1
    assert score == pytest.approx(expected)
