import pandas as pd
import pytest

from engine.stats import clamp, grouped_robust_z, jaccard, rank, robust_z, shrink, sigmoid, tokenize_title


def test_robust_z_known_answer():
    values = [10, 12, 11, 13, 100]  # median=12, MAD=median(|x-12|)=1
    assert robust_z(values, 12) == 0.0
    # (13-12) / (1.4826*1) = 0.674..
    assert abs(robust_z(values, 13) - (1 / 1.4826)) < 1e-6


def test_robust_z_clips_outliers():
    values = [1, 2, 3, 4, 5]
    assert robust_z(values, 1000) == 3.0
    assert robust_z(values, -1000) == -3.0


def test_robust_z_zero_spread_returns_zero():
    assert robust_z([5, 5, 5, 5], 5) == 0.0
    assert robust_z([5, 5, 5, 5], 9) == 0.0


def test_grouped_robust_z_uses_within_category_stats():
    # category A has 8+ rows (meets min_group_size): a tight spread around 10,
    # one outlier at 20. category B has only 2 rows, so it must fall back to
    # the *overall* median/MAD rather than its own (too-small) group stats.
    rows = [{"cat": "A", "v": v} for v in [8, 9, 10, 10, 10, 10, 11, 12, 20]]
    rows += [{"cat": "B", "v": v} for v in [10, 200]]
    df = pd.DataFrame(rows)
    z = grouped_robust_z(df, "v", "cat", min_group_size=8)
    assert z[df["cat"] == "A"].abs().le(3.0).all()

    overall_median = df["v"].median()
    overall_mad = (df["v"] - overall_median).abs().median()
    assert overall_mad > 0

    b_rows = df[df["cat"] == "B"]
    expected_200 = min(3.0, (200 - overall_median) / (1.4826 * overall_mad))
    assert abs(z.loc[b_rows.index[1]] - expected_200) < 1e-6


def test_sigmoid_bounds_and_midpoint():
    assert sigmoid(0) == 0.5
    assert 0.0 < sigmoid(-20) < 0.001
    assert 0.999 < sigmoid(20) < 1.0


def test_shrink_pulls_toward_pooled_when_weight_small():
    # tiny local weight -> result close to pooled value
    assert abs(shrink(local_value=100, local_weight=1, pooled_value=10, k=200_000) - 10) < 0.01
    # huge local weight -> result mostly local value (k is ~2% of the weight here)
    assert abs(shrink(local_value=100, local_weight=10_000_000, pooled_value=10, k=200_000) - 100) < 2.0


def test_clamp():
    assert clamp(5, 0, 10) == 5
    assert clamp(-5, 0, 10) == 0
    assert clamp(50, 0, 10) == 10


def test_tokenize_title_lowercases_and_drops_stopwords():
    assert tokenize_title("The BBL Shorts for La Faja") == {"bbl", "shorts", "faja"}


def test_jaccard_identical_and_disjoint_and_empty():
    assert jaccard({"a", "b"}, {"a", "b"}) == 1.0
    assert jaccard({"a"}, {"b"}) == 0.0
    assert jaccard(set(), set()) == 0.0
    assert jaccard({"a", "b", "c"}, {"b", "c", "d"}) == pytest.approx(2 / 4)


def test_rank_descending_best_first():
    assert rank([10, 30, 20]) == [3, 1, 2]


def test_rank_ascending():
    assert rank([10, 30, 20], descending=False) == [1, 3, 2]
