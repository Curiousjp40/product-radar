from engine.stages import classify_stage

BASE = dict(
    units_7d=100,
    category_median_units_7d=100,
    category_units_7d_p75=150,
    slope14=0.0,
    creator_count=10,
    category_creator_count_p40=10,
    saturation=0.0,
    weeks_tracked_last_8=0,
    recent_declining_runs=0,
    rank_delta=0,
)


def _with(**overrides):
    params = dict(BASE)
    params.update(overrides)
    return params


def test_emerging_below_median_rising_fast_few_creators():
    params = _with(
        units_7d=50, category_median_units_7d=100, slope14=0.10, creator_count=2, category_creator_count_p40=10
    )
    assert classify_stage(**params) == "emerging"


def test_rising_above_median_with_positive_slope():
    params = _with(units_7d=120, category_median_units_7d=100, slope14=0.05)
    assert classify_stage(**params) == "rising"


def test_peak_flat_slope_top_quartile_creators_outgrowing_units():
    params = _with(units_7d=160, category_units_7d_p75=150, slope14=0.0, saturation=0.3)
    assert classify_stage(**params) == "peak"


def test_evergreen_tracked_most_weeks_flat_slope():
    params = _with(units_7d=100, category_median_units_7d=200, weeks_tracked_last_8=7, slope14=0.0)
    assert classify_stage(**params) == "evergreen"


def test_declining_two_runs_of_negative_slope():
    params = _with(slope14=-0.05, recent_declining_runs=2)
    assert classify_stage(**params) == "declining"


def test_declining_single_bad_run_is_not_enough():
    params = _with(slope14=-0.05, recent_declining_runs=1)
    assert classify_stage(**params) != "declining"


def test_declining_rank_fell_sharply():
    params = _with(rank_delta=-25)
    assert classify_stage(**params) == "declining"


def test_declining_wins_over_evergreen_overlap():
    # would otherwise look evergreen (tracked 7/8 weeks, |slope|<0.02) but rank cratered
    params = _with(weeks_tracked_last_8=7, slope14=0.01, rank_delta=-30)
    assert classify_stage(**params) == "declining"


def test_fallback_is_new_to_radar_when_nothing_matches():
    # below median, mild negative slope, not enough weeks tracked, no rank data
    params = _with(units_7d=50, category_median_units_7d=100, slope14=-0.01, weeks_tracked_last_8=1)
    assert classify_stage(**params) == "new_to_radar"


def test_first_week_product_is_new_to_radar_not_evergreen():
    # the exact real-world case this fix targets: week 1, flat/no slope signal,
    # units right at the category median -- used to fall through to "evergreen"
    params = _with(units_7d=100, category_median_units_7d=100, slope14=0.0, weeks_tracked_last_8=1)
    assert classify_stage(**params) == "new_to_radar"


def test_evergreen_requires_six_of_eight_weeks_not_just_flat_slope():
    # flat slope alone (no emerging/rising/peak/declining match) with too few
    # tracked weeks must NOT be labeled evergreen just because it's quiet
    params = _with(units_7d=100, category_median_units_7d=100, slope14=0.0, weeks_tracked_last_8=5)
    assert classify_stage(**params) == "new_to_radar"
