from engine.creator_gap import pocas_creadoras_latinas


def test_false_when_spanish_share_missing():
    assert pocas_creadoras_latinas(None, 500) is False


def test_false_when_units_7d_missing():
    assert pocas_creadoras_latinas(0.1, None) is False


def test_true_when_strong_sales_and_few_spanish_videos():
    assert pocas_creadoras_latinas(0.1, 500) is True


def test_false_when_spanish_share_is_not_low():
    assert pocas_creadoras_latinas(0.5, 500) is False


def test_false_when_units_7d_below_floor():
    assert pocas_creadoras_latinas(0.1, 50) is False


def test_boundary_values_are_exclusive_inclusive_as_documented():
    # spanish_share_max is an exclusive upper bound, min_units_7d inclusive.
    assert pocas_creadoras_latinas(0.3, 100) is False
    assert pocas_creadoras_latinas(0.29, 100) is True


def test_custom_thresholds_are_respected():
    assert pocas_creadoras_latinas(0.4, 50, spanish_share_max=0.5, min_units_7d=50) is True
