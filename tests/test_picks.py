import random

import pytest

from engine.picks import (
    blended_rank,
    build_top10,
    compute_blended_ranks,
    enforce_group_minimums,
    exclude_recent_films,
    filter_diverse_topn,
    is_near_duplicate,
    pick_explore_categories,
    render_reason,
    select_top_reasons,
    thompson_sample_categories,
)


def _cand(pid, category="cat", shop="shop1", title=None, score=50, ev=10):
    # Default title leads with a distinct per-pid "brand" token (Brand0,
    # Brand1, ...) so unrelated tests exercising the category/shop/event caps
    # don't accidentally collide on extract_brand's first-word heuristic and
    # get collapsed by the max_per_brand=1 default -- see test_max_per_brand_cap
    # below for the test that deliberately shares a brand.
    return {
        "product_id": pid,
        "category": category,
        "shop_id": shop,
        "title": title or f"Brand{pid} Product",
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


def test_filter_diverse_topn_respects_brand_cap():
    # real case, 2026-W42: two "Comfrt"-titled products, different shops and
    # categories, both made the same week's picks -- max_per_brand=1 must
    # keep only the first.
    candidates = [
        _cand("0", category="winter_clothing", shop="shopA", title="Comfrt Memory Foam Clog Slides", score=90),
        _cand("1", category="shoes", shop="shopB", title="Comfrt Platform Sandals", score=80),
        _cand("2", category="furniture", shop="shopC", title="COLAMY Dining Chair", score=70),
    ]
    out = filter_diverse_topn(candidates, n=3, max_per_category=3, max_per_shop=2, max_per_brand=1)
    ids = {c["product_id"] for c in out}
    assert ids == {"0", "2"}


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


def test_filter_diverse_topn_respects_per_event_cap():
    candidates = [_cand(str(i), category=f"cat{i}", shop=f"shop{i}") for i in range(4)]
    for c in candidates:
        c["matched_event_id"] = "halloween_2026"
    out = filter_diverse_topn(candidates, n=4, max_per_category=3, max_per_shop=2, event_caps={"halloween_2026": 1})
    assert len(out) == 1


def test_filter_diverse_topn_season_event_cap_ignores_unmatched_candidates():
    candidates = [_cand(str(i), category=f"cat{i}", shop=f"shop{i}") for i in range(3)]
    candidates[0]["matched_event_id"] = "halloween_2026"
    candidates[1]["matched_event_id"] = "halloween_2026"
    candidates[2]["matched_event_id"] = None  # no event match -- never capped
    out = filter_diverse_topn(candidates, n=3, max_per_category=3, max_per_shop=2, event_caps={"halloween_2026": 1})
    ids = {c["product_id"] for c in out}
    assert ids == {"0", "2"}  # first halloween pick kept, second dropped, non-event one kept


def test_filter_diverse_topn_event_with_no_configured_cap_is_never_capped():
    # e.g. bfcm_2026: a broad scoring boost that matches most candidates --
    # it must NOT collapse the picks list just because it has no entry in
    # event_caps (the real bug this guards against, found 2026-10-15).
    candidates = [_cand(str(i), category=f"cat{i}", shop=f"shop{i}") for i in range(3)]
    for c in candidates:
        c["matched_event_id"] = "bfcm_2026"
    out = filter_diverse_topn(candidates, n=3, max_per_category=3, max_per_shop=2, event_caps={"halloween_2026": 1})
    assert len(out) == 3


def test_filter_diverse_topn_caps_by_title_keyword_even_when_best_event_differs():
    # the real bug this guards against: Halloween costumes whose matched_event_id
    # is bfcm_2026 (Black Friday's boost outscores Halloween's as its window
    # closes) must still count against Halloween's cap via capped_event_ids,
    # set from title keywords -- otherwise "max 1 Halloween pick" is inert.
    candidates = [_cand(str(i), category=f"cat{i}", shop=f"shop{i}") for i in range(3)]
    for c in candidates:
        c["matched_event_id"] = "bfcm_2026"
        c["capped_event_ids"] = ["halloween_2026"]
    out = filter_diverse_topn(candidates, n=3, max_per_category=3, max_per_shop=2, event_caps={"halloween_2026": 1})
    assert len(out) == 1


def test_filter_diverse_topn_no_season_cap_by_default():
    candidates = [_cand(str(i), category=f"cat{i}", shop=f"shop{i}") for i in range(3)]
    for c in candidates:
        c["matched_event_id"] = "halloween_2026"
    out = filter_diverse_topn(candidates, n=3, max_per_category=3, max_per_shop=2)
    assert len(out) == 3


def test_enforce_group_minimums_backfills_moda_core_and_hogar():
    # real case, 2026-W42: the Top 9 had zero shapewear/dresses/sets (the
    # core-tier Moda categories) and too little Hogar, while weaker
    # secondary-tier picks (shoes) filled the list instead.
    categories_cfg = {
        "shoes": {"group": "fashion", "tier": "secondary"},
        "shapewear": {"group": "fashion", "tier": "core"},
        "furniture": {"group": "home", "tier": "core"},
    }
    core_selected = [
        {"product_id": "0", "category": "shoes", "shop_id": "shopA", "title": "Crocs Clogs", "blended_rank": 1},
        {"product_id": "1", "category": "shoes", "shop_id": "shopB", "title": "Nike Sneakers", "blended_rank": 2},
    ]
    ranked = core_selected + [
        {"product_id": "2", "category": "shapewear", "shop_id": "shopC", "title": "YIANNA Shapewear", "blended_rank": 3},
        {"product_id": "3", "category": "furniture", "shop_id": "shopD", "title": "COLAMY Chair", "blended_rank": 4},
    ]
    requirements = [
        (lambda meta: meta.get("group") == "fashion" and meta.get("tier") == "core", 1),
        (lambda meta: meta.get("group") == "home", 1),
    ]
    out = enforce_group_minimums(
        core_selected,
        ranked,
        categories_cfg,
        requirements,
        max_per_category=3,
        max_per_shop=2,
        max_per_brand=1,
        title_jaccard_threshold=0.6,
    )
    assert {c["product_id"] for c in out} == {"2", "3"}


def test_enforce_group_minimums_leaves_requirement_unmet_without_a_candidate():
    # no home-group category exists at all this week -- must not crash or
    # force a bad pick, just leave the requirement unmet.
    categories_cfg = {"shoes": {"group": "fashion", "tier": "secondary"}}
    core_selected = [
        {"product_id": "0", "category": "shoes", "shop_id": "shopA", "title": "Crocs Clogs", "blended_rank": 1},
    ]
    requirements = [(lambda meta: meta.get("group") == "home", 1)]
    out = enforce_group_minimums(
        core_selected,
        core_selected,
        categories_cfg,
        requirements,
        max_per_category=3,
        max_per_shop=2,
        max_per_brand=1,
        title_jaccard_threshold=0.6,
    )
    assert out == core_selected


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


def test_build_top10_displays_core_first_then_explore_then_evergreen():
    # selection priority (evergreen/explore claim a product first) is
    # independent from DISPLAY order: core picks show first, in their
    # existing blended-rank order, then explore, then evergreen last.
    core = [_cand("c1"), _cand("c2"), _cand("c3")]
    explore = [_cand("e1"), _cand("e2")]
    evergreen = _cand("ever1")
    picks = build_top10(core, explore, evergreen, core_slots=3, explore_slots=2, evergreen_slots=1)
    kinds = [p["kind"] for p in picks]
    assert kinds == ["core", "core", "core", "explore", "explore", "evergreen"]
    ids = [p["product_id"] for p in picks]
    assert ids == ["c1", "c2", "c3", "e1", "e2", "ever1"]
    assert [p["slot"] for p in picks] == [1, 2, 3, 4, 5, 6]


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
    # tu voice, past tense, each a complete sentence (rewritten 2026-10-17)
    assert render_reason("momentum", "es", pct=38) == "Tus ventas subieron 38% esta semana."
    assert render_reason("momentum", "en", pct=38) == "Your sales went up 38% this week."
    assert render_reason("earnings", "es", amount=6.4) == "Pagas ~$6.40 por venta."


def test_render_reason_category_fit_cites_a_real_number():
    es = render_reason("category_fit", "es", category_label="Fajas", gpm=20.79)
    assert es == "Fajas: $20.79 por cada 1,000 vistas para ti."
    en = render_reason("category_fit", "en", category_label="Shapewear", gpm=20.79)
    assert en == "Shapewear: $20.79 per 1,000 views for you."


def test_render_reason_seasonality_uses_pre_pluralized_days_phrase():
    es = render_reason("seasonality", "es", event="Black Friday", days_phrase="faltan 44 días")
    assert es == "Buen momento antes de Black Friday (faltan 44 días)."
    en = render_reason("seasonality", "en", event="Black Friday", days_phrase="44 days left")
    assert en == "Good timing before Black Friday (44 days left)."


def test_render_reason_spanish_gap_has_no_mojibake():
    es = render_reason("spanish_gap", "es", n=0, total=6)
    assert "español" in es
    assert es == "Pocas creadoras hablan de esto en español (0 de 6 videos)."


def test_render_reason_unknown_component_raises():
    with pytest.raises(KeyError):
        render_reason("not_a_real_component", "es")
