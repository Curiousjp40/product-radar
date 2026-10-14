import random

import pytest

from engine.picks import (
    blended_rank,
    build_top10,
    compute_blended_ranks,
    exclude_recent_films,
    filter_diverse_topn,
    is_near_duplicate,
    pick_explore_categories,
    render_reason,
    select_top_reasons,
    thompson_sample_categories,
)


def _cand(pid, category="cat", shop="shop1", title=None, score=50, ev=10):
    return {
        "product_id": pid,
        "category": category,
        "shop_id": shop,
        "title": title or f"Product {pid}",
        "score": score,
        "ev_typical": ev,
    }


def test_blended_rank_equal_weights():
    assert blended_rank(score_rank=2, ev_rank=4) == 3.0


def test_compute_blended_ranks_sorts_best_first():
    candidates = [
        _cand("a", score=90, ev=5),
        _cand("b", score=50, ev=50),
        _cand("c", score=10, ev=10),
    ]
    out = compute_blended_ranks(candidates)
    assert [c["product_id"] for c in out] == sorted(
        [c["product_id"] for c in out], key=lambda pid: next(x["blended_rank"] for x in out if x["product_id"] == pid)
    )
    # b has best EV and middling score; a has best score. Either could blend-rank first,
    # but c (worst on both) must be last.
    assert out[-1]["product_id"] == "c"


def test_is_near_duplicate():
    assert is_near_duplicate("Seamless Tummy Control Shorts Beige", "Seamless Tummy Control Shorts Black")
    assert not is_near_duplicate("Seamless Tummy Control Shorts", "Ceramic Vase Set")


def test_filter_diverse_topn_respects_category_cap():
    candidates = [_cand(str(i), category="shapewear", shop=f"shop{i}") for i in range(5)]
    out = filter_diverse_topn(candidates, n=5, max_per_category=3, max_per_shop=2)
    assert len(out) == 3


def test_filter_diverse_topn_respects_shop_cap():
    candidates = [_cand(str(i), category=f"cat{i}", shop="sameshop") for i in range(5)]
    out = filter_diverse_topn(candidates, n=5, max_per_category=3, max_per_shop=2)
    assert len(out) == 2


def test_filter_diverse_topn_drops_near_duplicate_titles():
    candidates = [
        _cand("a", title="Seamless Tummy Control Shorts Beige"),
        _cand("b", title="Seamless Tummy Control Shorts Black"),
        _cand("c", title="Ceramic Vase Set"),
    ]
    out = filter_diverse_topn(candidates, n=5)
    ids = [c["product_id"] for c in out]
    assert "a" in ids
    assert "b" not in ids
    assert "c" in ids


def test_exclude_recent_films_keeps_winner_again():
    candidates = [_cand("a"), _cand("b")]
    out = exclude_recent_films(candidates, recently_filmed_product_ids={"a", "b"}, winner_again_product_ids={"a"})
    assert [c["product_id"] for c in out] == ["a"]


def test_thompson_sample_categories_deterministic_with_seeded_rng():
    rng = random.Random(42)
    beliefs = {"home_decor": (5, 2), "shapewear": (2, 5)}
    sampled = thompson_sample_categories(beliefs, rng=rng)
    assert set(sampled.keys()) == {"home_decor", "shapewear"}
    assert all(0 <= v <= 1 for v in sampled.values())


def test_pick_explore_categories_prefers_under_tested():
    sampled = {"home_decor": 0.9, "shapewear": 0.95, "beauty_hair": 0.5}
    trial_counts = {"home_decor": 0, "shapewear": 10, "beauty_hair": 1}
    chosen = pick_explore_categories(sampled, trial_counts, k=2, min_trials_considered_tested=5)
    assert "shapewear" not in chosen  # well-tested, skipped even though highest sampled
    assert "home_decor" in chosen
    assert "beauty_hair" in chosen


def test_pick_explore_categories_fills_from_tested_if_not_enough_under_tested():
    sampled = {"home_decor": 0.9, "shapewear": 0.95}
    trial_counts = {"home_decor": 0, "shapewear": 10}
    chosen = pick_explore_categories(sampled, trial_counts, k=2, min_trials_considered_tested=5)
    assert set(chosen) == {"home_decor", "shapewear"}


def test_build_top10_fills_slots_in_priority_order_and_dedupes():
    core = [_cand(str(i)) for i in range(10)]
    explore = [_cand("e1", category="home_decor"), _cand("e2", category="home_decor")]
    evergreen = _cand("ever1")
    picks = build_top10(core, explore, evergreen, core_slots=7, explore_slots=2, evergreen_slots=1)
    assert len(picks) == 10
    kinds = [p["kind"] for p in picks]
    assert kinds.count("core") == 7
    assert kinds.count("explore") == 2
    assert kinds.count("evergreen") == 1
    assert [p["slot"] for p in picks] == list(range(1, 11))


def test_build_top10_dedupes_overlap_between_buckets():
    core = [_cand("a"), _cand("b"), _cand("c")]
    explore = [_cand("a")]  # same product as a core candidate
    picks = build_top10(core, explore, evergreen_candidate=None, core_slots=3, explore_slots=1, evergreen_slots=1)
    ids = [p["product_id"] for p in picks]
    assert ids.count("a") == 1


def test_select_top_reasons_picks_largest_magnitude():
    components = {"momentum": 0.1, "earnings": -2.0, "fit": 0.5, "seasonality": 1.5}
    assert select_top_reasons(components, max_reasons=2) == ["earnings", "seasonality"]


def test_render_reason_es_and_en():
    assert render_reason("momentum", "es", pct=38) == "Ventas subiendo 38% esta semana"
    assert render_reason("momentum", "en", pct=38) == "Sales up 38% this week"
    assert render_reason("earnings", "es", amount=6.4) == "Pagas ~$6.40 por venta"


def test_render_reason_unknown_component_raises():
    with pytest.raises(KeyError):
        render_reason("not_a_real_component", "es")
