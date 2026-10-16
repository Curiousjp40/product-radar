from engine.midweek_refresh import estimate_credits, flag_rising_fast


def test_flag_rising_fast_flags_a_10plus_place_jump():
    old_ranks = {"p1": 25}
    candidates = [{"product_id": "p1", "rank": 10}]
    flag_rising_fast(candidates, old_ranks)
    assert candidates[0]["rising_fast"] is True
    assert candidates[0]["is_new_entry"] is False


def test_flag_rising_fast_does_not_flag_a_smaller_jump():
    old_ranks = {"p1": 14}
    candidates = [{"product_id": "p1", "rank": 10}]
    flag_rising_fast(candidates, old_ranks)
    assert candidates[0]["rising_fast"] is False


def test_flag_rising_fast_marks_new_entries_without_flagging_rising():
    candidates = [{"product_id": "p1", "rank": 3}]
    flag_rising_fast(candidates, {})
    assert candidates[0]["is_new_entry"] is True
    assert candidates[0]["rising_fast"] is False


def test_flag_rising_fast_ignores_a_product_that_fell_in_rank():
    old_ranks = {"p1": 3}
    candidates = [{"product_id": "p1", "rank": 20}]
    flag_rising_fast(candidates, old_ranks)
    assert candidates[0]["rising_fast"] is False


def test_flag_rising_fast_respects_a_custom_threshold():
    old_ranks = {"p1": 15}
    candidates = [{"product_id": "p1", "rank": 10}]
    flag_rising_fast(candidates, old_ranks, threshold=3)
    assert candidates[0]["rising_fast"] is True


def test_estimate_credits_sums_pages_across_pinned_categories():
    category_meta = {
        "shapewear": {"fastmoss_category_id": 1, "pages": 3},
        "furniture": {"fastmoss_category_id": 2, "pages": 2},
        "unpinned": {"pages": 5},  # no fastmoss_category_id -- excluded
    }
    assert estimate_credits(category_meta) == 5
