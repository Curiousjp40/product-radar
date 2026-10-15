from engine.saturation import saturation_badge


def test_none_without_daily_units():
    assert saturation_badge(None, creator_count=5, units_7d=500) is None
    assert saturation_badge([], creator_count=5, units_7d=500) is None


def test_none_without_creator_count():
    assert saturation_badge(list(range(1, 15)), creator_count=None, units_7d=500) is None


def test_none_when_units_7d_is_zero_or_negative():
    assert saturation_badge(list(range(1, 15)), creator_count=5, units_7d=0) is None


def test_entra_ya_when_units_growing_and_few_creators():
    # Strongly increasing daily units -> positive slope; 4 creators per 100
    # units sold this week, below the entra_ya_max default of 2.0... use a
    # low creator_count/units_7d ratio instead (1 creator per 100 units).
    result = saturation_badge(list(range(1, 15)), creator_count=5, units_7d=500)
    assert result is not None
    assert result["level"] == "entra_ya"
    assert result["reason_es"] and result["reason_en"]


def test_muy_lleno_when_creator_density_exceeds_threshold():
    # 60 creators per 100 units sold this week -- way past the default
    # muy_lleno_min of 6.0, regardless of whether units are growing.
    result = saturation_badge(list(range(1, 15)), creator_count=60, units_7d=100)
    assert result is not None
    assert result["level"] == "muy_lleno"


def test_muy_lleno_when_units_flat_and_moderate_creator_density():
    # Flat daily units (slope ~0) with density above entra_ya_max (2.0) but
    # below muy_lleno_min (6.0): 4 creators per 100 units, units not growing.
    flat = [10.0] * 14
    result = saturation_badge(flat, creator_count=4, units_7d=100)
    assert result is not None
    assert result["level"] == "muy_lleno"


def test_normal_otherwise():
    # Declining units are excluded by the flat/declining branch requiring
    # density > entra_ya_max, so use a modest density with flat units that
    # sits right at entra_ya_max (not above it).
    flat = [10.0] * 14
    result = saturation_badge(flat, creator_count=2, units_7d=100)
    assert result is not None
    assert result["level"] == "normal"


def test_custom_thresholds_are_respected():
    # With a very high entra_ya_max, even a dense ratio counts as "room to grow".
    result = saturation_badge(
        list(range(1, 15)),
        creator_count=10,
        units_7d=100,
        creators_per_100_units_entra_ya_max=50.0,
        creators_per_100_units_muy_lleno_min=90.0,
    )
    assert result is not None
    assert result["level"] == "entra_ya"


def test_flat_units_count_as_flat_even_with_tiny_positive_float_slope(monkeypatch):
    # GitHub's runners compute polyfit's slope for a constant series as a tiny
    # positive number (~1e-17) instead of 0; that must still count as flat.
    import engine.saturation as saturation

    monkeypatch.setattr(saturation, "slope_log1p", lambda _units: 2.4e-17)
    result = saturation.saturation_badge([10.0] * 14, creator_count=4, units_7d=100)
    assert result is not None
    assert result["level"] == "muy_lleno"
