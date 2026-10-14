from datetime import date

import pytest

from engine.seasonality import event_term, personal_term, seasonality_score


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
