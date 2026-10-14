from datetime import date

import pytest

from engine.seasonality import (
    boosted_category_multiplier,
    event_term,
    personal_term,
    season_ending_factor,
    seasonality_score,
    title_matches_event_keywords,
)


def test_event_term_zero_when_far_in_future():
    assert event_term(today=date(2026, 1, 1), film_start=date(2026, 3, 1), film_end=date(2026, 3, 20)) == 0.0


def test_event_term_zero_when_already_past():
    assert event_term(today=date(2026, 5, 1), film_start=date(2026, 3, 1), film_end=date(2026, 3, 20)) == 0.0


def test_event_term_full_strength_inside_window():
    assert event_term(today=date(2026, 10, 15), film_start=date(2026, 9, 10), film_end=date(2026, 10, 20)) == 1.0


def test_event_term_ramps_up_as_window_approaches():
    near = event_term(today=date(2026, 10, 25), film_start=date(2026, 11, 1), film_end=date(2026, 12, 2))
    far = event_term(today=date(2026, 10, 12), film_start=date(2026, 11, 1), film_end=date(2026, 12, 2))
    assert 0 < far < near < 1.0


def test_personal_term_smoothed_share():
    # category made all the GMV that month -> share close to but not exactly 1.0 (Laplace smoothing)
    share = personal_term(category_month_gmv=1000, total_month_gmv=1000, n_categories=5, alpha=1.0)
    assert 0.9 < share < 1.0


def test_personal_term_zero_denominator():
    assert personal_term(0, 0, 0, alpha=0.0) == 0.0


def test_seasonality_score_weighted_sum():
    assert seasonality_score(event=1.0, personal=0.5) == pytest.approx(0.6 * 1.0 + 0.4 * 0.5)


def test_season_ending_factor_full_strength_when_far_from_end():
    assert season_ending_factor(today=date(2026, 10, 1), film_end=date(2026, 10, 20)) == 1.0


def test_season_ending_factor_real_halloween_case():
    # the exact case that motivated this: today 2026-10-14, Halloween ends 2026-10-20
    factor = season_ending_factor(today=date(2026, 10, 14), film_end=date(2026, 10, 20), warning_days=14, floor=0.3)
    assert factor == pytest.approx(0.3 + 0.7 * (6 / 14))
    assert 0.3 < factor < 1.0


def test_season_ending_factor_at_floor_on_last_day():
    assert season_ending_factor(today=date(2026, 10, 20), film_end=date(2026, 10, 20), floor=0.3) == pytest.approx(0.3)


def test_season_ending_factor_zero_after_window_closes():
    assert season_ending_factor(today=date(2026, 10, 21), film_end=date(2026, 10, 20)) == 0.0


def test_boosted_category_multiplier():
    boosted = ["shapewear", "womens_clothing"]
    assert boosted_category_multiplier("shapewear", boosted) == 1.3
    assert boosted_category_multiplier("beauty_hair", boosted) == 1.0


def test_title_matches_event_keywords_real_costume_titles():
    # these real titles are tagged config_category="womens_clothing" by FastMoss,
    # not "seasonal" -- title keywords are how Halloween's pick cap still catches them
    assert title_matches_event_keywords("Tipsy Elves Women's Original Halloween Costumes", ["costume", "halloween"])
    assert title_matches_event_keywords("Play Along Cowboy Costume", ["costume", "halloween"])
    assert title_matches_event_keywords("No Prisoners Pirate Costume", ["costume", "halloween"])


def test_title_matches_event_keywords_case_insensitive_and_no_match():
    assert title_matches_event_keywords("SPOOKY HALLOWEEN DECOR", ["halloween"])
    assert not title_matches_event_keywords("Cozy Wool Blanket", ["costume", "halloween"])
