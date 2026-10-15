import json
from datetime import date

import pandas as pd

from engine.config import load_all
from engine.run import (
    _creator_stats,
    active_categories,
    assemble_picks,
    build_reasons,
    candidates_to_export_dicts,
    product_detail_dict,
    score_pool,
    tiktok_search_url,
)

# Roxie's real views-weighted average category_gpm is ~$10.89 (see
# tests/test_fit.py's test_creator_avg_category_gpm_matches_real_roxie_data).
CREATOR_AVG_GPM = 10.89


def _row(**overrides) -> pd.Series:
    base = {
        "wow": 0.05,
        "earnings_per_sale": 2.0,
        "z_spanish_gap": 0.1,
        "season_val": 0.0,
        "z_fit": 3.0,  # largest magnitude by default -- "fit" would normally win a slot
        "category_gpm": 20.79,
        "category_label_es": "Fajas y shapewear",
        "category_label_en": "Shapewear",
        "spanish_share": None,
        "spanish_video_count": 0,
        "matched_event_id": None,
        "matched_event_label_es": None,
        "matched_event_label_en": None,
        "days_to_event_end": None,
    }
    base.update(overrides)
    return pd.Series(base)


def test_build_reasons_cites_category_fit_when_above_her_average():
    reasons_es, _ = build_reasons(_row(category_gpm=20.79), creator_avg_gpm=CREATOR_AVG_GPM)
    assert any("por cada 1,000 vistas" in r for r in reasons_es)


def test_build_reasons_skips_category_fit_below_average_and_falls_back():
    # z_fit is still the largest-magnitude component, but her category_gpm here
    # (3.06, home_decor) is below her ~$10.89 average -- citing it would undersell
    # the pick, so "fit" must be skipped and the next-strongest signal (earnings)
    # takes its slot instead of the reasons list just coming up short.
    reasons_es, reasons_en = build_reasons(_row(category_gpm=3.06), creator_avg_gpm=CREATOR_AVG_GPM)
    assert not any("por cada 1,000 vistas" in r for r in reasons_es)
    assert any("Pagas ~$2.00 por venta" in r for r in reasons_es)
    assert any("You earn ~$2.00 per sale" in r for r in reasons_en)


def test_build_reasons_skips_category_fit_when_no_average_given():
    reasons_es, _ = build_reasons(_row(category_gpm=20.79), creator_avg_gpm=None)
    assert not any("por cada 1,000 vistas" in r for r in reasons_es)


def test_build_reasons_seasonality_cites_pluralized_days_real_example():
    # the real motivating example: Black Friday 2026, 44 days from 2026-10-14
    row = _row(
        z_fit=0.0,
        season_val=5.0,  # largest magnitude -> seasonality wins a slot
        matched_event_id="bfcm_2026",
        matched_event_label_es="Black Friday",
        matched_event_label_en="Black Friday",
        days_to_event_end=44,
    )
    reasons_es, reasons_en = build_reasons(row, creator_avg_gpm=CREATOR_AVG_GPM)
    assert "Buen momento antes de Black Friday (faltan 44 días)." in reasons_es
    assert "Good timing before Black Friday (44 days left)." in reasons_en


def test_build_reasons_seasonality_skipped_when_event_already_passed():
    row = _row(
        z_fit=0.0,
        season_val=5.0,
        matched_event_id="halloween_2026",
        matched_event_label_es="Halloween",
        matched_event_label_en="Halloween",
        days_to_event_end=-2,
    )
    reasons_es, _ = build_reasons(row, creator_avg_gpm=CREATOR_AVG_GPM)
    assert not any("Halloween" in r for r in reasons_es)


def _weights(
    core_slots,
    explore_slots,
    max_per_category=3,
    max_per_shop=2,
    max_per_brand=10,
    min_moda_core_picks=0,
    min_hogar_picks=0,
):
    # max_per_brand defaults loose (10) here since these tests target the
    # category/shop caps specifically, and several synthetic candidate sets
    # share a leading title word (e.g. "Shapewear Product 0".."3") that would
    # otherwise collide under extract_brand's first-word heuristic.
    return {
        "picks": {
            "core_slots": core_slots,
            "explore_slots": explore_slots,
            "evergreen_slots": 0,
            "max_per_category": max_per_category,
            "max_per_shop": max_per_shop,
            "max_per_brand": max_per_brand,
            "min_moda_core_picks": min_moda_core_picks,
            "min_hogar_picks": min_hogar_picks,
            "title_jaccard_duplicate_threshold": 0.6,
        }
    }


def test_assemble_picks_category_cap_counts_explore_too():
    # the real bug this guards against: max_per_category=3 was enforced for
    # core picks only -- an explore pick from the same already-full category
    # could still sneak in as a 4th, since explore candidates are drawn
    # straight from the full ranked list, not from the already-capped core
    # selection. Only "shapewear" exists here, so if the cap doesn't carry
    # over, the single explore slot has nothing else to pick but a 4th
    # shapewear product.
    rows = [
        {
            "product_id": str(i),
            "config_category": "shapewear",
            "shop_id": f"shop{i}",
            "title": f"Shapewear Product {i}",
            "score": 90 - i,
            "ev_typical": 50 - i,
        }
        for i in range(4)
    ]
    df = pd.DataFrame(rows)
    picks = assemble_picks(df, _weights(core_slots=3, explore_slots=1))
    assert len(picks) == 3  # the 4th shapewear candidate must NOT fill the explore slot
    assert all(p["kind"] == "core" for p in picks)


def test_assemble_picks_explore_slot_rejects_near_duplicate_of_core_pick():
    # the real bug this guards against, 2026-W42: a core "Crocs Women's Dylan
    # Animal Platform Clogs" pick and a near-identical explore "Crocs Women's
    # Dylan Platform Elevated Clogs" from the SAME shop both made the list --
    # max_per_shop=2 allows 2 from one shop, so only the title-similarity
    # check (missing from the explore loop before this fix) can catch this.
    # filter_diverse_topn already drops the near-duplicate from `diverse`
    # itself, so without the explore loop's OWN near-dup check it would sneak
    # back in from the full `ranked` list the explore loop draws from.
    rows = [
        {
            "product_id": "0",
            "config_category": "shoes",
            "shop_id": "CROCS US SHOP",
            "title": "Crocs Women's Dylan Animal Platform Clogs",
            "score": 90,
            "ev_typical": 50,
        },
        {
            "product_id": "1",
            "config_category": "shoes",
            "shop_id": "CROCS US SHOP",
            "title": "Crocs Women's Dylan Platform Elevated Clogs",
            "score": 80,
            "ev_typical": 40,
        },
    ]
    df = pd.DataFrame(rows)
    picks = assemble_picks(df, _weights(core_slots=1, explore_slots=1))
    assert len(picks) == 1
    assert picks[0]["product_id"] == "0"
    assert all(p["kind"] == "core" for p in picks)


def test_assemble_picks_backfills_moda_core_and_hogar_minimums():
    # real case, 2026-W42: two strong "shoes" (secondary-tier Moda) picks
    # outranked a core-tier Moda pick (shapewear) and a Hogar pick
    # (furniture), so neither made the Top 9. min_moda_core_picks and
    # min_hogar_picks must backfill them even though they score worse --
    # and the swap must actually surface in the final picks, not just an
    # internal `core_selected` that build_top10 then silently ignores.
    rows = [
        {
            "product_id": "0",
            "config_category": "shoes",
            "shop_id": "shopA",
            "title": "Crocs Clogs",
            "score": 95,
            "ev_typical": 60,
        },
        {
            "product_id": "1",
            "config_category": "shoes",
            "shop_id": "shopB",
            "title": "Nike Sneakers",
            "score": 90,
            "ev_typical": 55,
        },
        {
            "product_id": "2",
            "config_category": "shapewear",
            "shop_id": "shopC",
            "title": "YIANNA Shapewear",
            "score": 50,
            "ev_typical": 20,
        },
        {
            "product_id": "3",
            "config_category": "furniture",
            "shop_id": "shopD",
            "title": "COLAMY Chair",
            "score": 45,
            "ev_typical": 15,
        },
    ]
    df = pd.DataFrame(rows)
    categories_cfg = {
        "shoes": {"group": "fashion", "tier": "secondary"},
        "shapewear": {"group": "fashion", "tier": "core"},
        "furniture": {"group": "home", "tier": "core"},
    }
    weights = _weights(core_slots=2, explore_slots=0, min_moda_core_picks=1, min_hogar_picks=1)
    picks = assemble_picks(df, weights, categories_cfg=categories_cfg)
    assert {p["product_id"] for p in picks} == {"2", "3"}
    assert all(p["kind"] == "core" for p in picks)


def test_assemble_picks_skips_minimums_when_categories_cfg_omitted():
    # backward compatibility: callers (and older tests) that don't pass
    # categories_cfg get the plain blended-rank picks, unaffected.
    rows = [
        {
            "product_id": "0",
            "config_category": "shoes",
            "shop_id": "shopA",
            "title": "Crocs Clogs",
            "score": 95,
            "ev_typical": 60,
        },
        {
            "product_id": "1",
            "config_category": "shoes",
            "shop_id": "shopB",
            "title": "Nike Sneakers",
            "score": 90,
            "ev_typical": 55,
        },
    ]
    df = pd.DataFrame(rows)
    weights = _weights(core_slots=2, explore_slots=0, min_moda_core_picks=1, min_hogar_picks=1)
    picks = assemble_picks(df, weights)
    assert {p["product_id"] for p in picks} == {"0", "1"}


def _full_candidate(product_id: str, title: str, config_category: str = "womens_clothing", **overrides) -> dict:
    """A candidate dict with every field score_pool/ingest_from_snapshots
    produce -- for synthetic score_pool tests that don't want to depend on
    committed real snapshot files (which the 2026-10-18 top-50-by-units-sold
    rewrite made this test's old 2026-W42 snapshots structurally obsolete:
    they were single-page, pre-pagination)."""
    base = {
        "product_id": product_id,
        "config_category": config_category,
        "category_l1": "Womenswear & Underwear",
        "category_l2": None,
        "category_l3": None,
        "title": title,
        "image_url": None,
        "shop_id": f"shop-{product_id}",
        "shop_name": "Shop",
        "price": 40.0,
        "commission_rate": 0.15,
        "units_7d": 100,
        "gmv_7d": 4000.0,
        "units_total": 1000,
        "growth_rate": 0.1,
        "rank": 1,
        "delisted": False,
        "creator_count": 10,
        "video_count": 20,
        "ads_share_pct": None,
        "channel_breakdown": None,
        "spanish_share": None,
        "videos": None,
        "daily_units_14": None,
    }
    base.update(overrides)
    return base


def test_score_pool_cowboy_costume_matches_halloween_not_black_friday():
    # the real case this guards against: a costume product is category-
    # tagged "womens_clothing" by FastMoss, which also matches bfcm_2026's
    # broad category list -- Black Friday's boost used to win the scoring
    # comparison and label it "Black Friday in 49 days." Title keywords
    # ("costume") must identify it as Halloween instead, for both the
    # matched event and the reason's day count.
    config = load_all()
    pool = [
        _full_candidate("1", "Play Along Cowboy Costume", config_category="dresses"),
        _full_candidate("2", "Caramela Beauty Oil", config_category="home_decor"),  # not a costume -> unaffected
    ]
    creator_stats = _creator_stats(config)
    today = date(2026, 10, 14)
    df = score_pool(pool, config, creator_stats, today)

    row = df[df["title"] == "Play Along Cowboy Costume"].iloc[0]
    assert row["matched_event_id"] == "halloween_2026"
    assert row["days_to_event_end"] == 17  # 2026-10-31 (Halloween) - 2026-10-14

    other = df[df["title"] == "Caramela Beauty Oil"].iloc[0]
    assert other["matched_event_id"] == "bfcm_2026"  # a real (non-costume) candidate still gets the Black Friday boost


def _candidate_row(product_id, **overrides):
    base = {
        "product_id": product_id,
        "title": product_id,
        "config_category": "shapewear",
        "shop_name": "Shop",
        "stage": "rising",
        "rank": 1,
        "price": 10.0,
        "commission_rate": 0.1,
        "earnings_per_sale": 1.5,
        "units_7d": 100,
        "units_total": 1000,
        "score": 50,
        "ev_typical": 5.0,
    }
    base.update(overrides)
    return base


def test_candidates_to_export_dicts_nan_daily_units_becomes_empty_list():
    # the real bug this guards against: a candidate outside the trend-fetch
    # pool never gets daily_units_14 set at all, which pandas backfills as
    # NaN (not None) once the column exists on any other row -- `or []`
    # doesn't catch that (nan is truthy), so json.dumps wrote a literal NaN
    # token: invalid JSON that broke JSON.parse on the whole candidates.json
    # file (found 2026-10-17 verifying the Radar page against real data).
    df = pd.DataFrame(
        [
            _candidate_row("a", daily_units_14=[1, 2, 3]),
            _candidate_row("b"),  # no daily_units_14 key -> NaN in the column
        ]
    )
    out = candidates_to_export_dicts(df, _CATEGORIES_CFG, pick_ids=set())
    assert out[0]["daily_units"] == [1, 2, 3]
    assert out[1]["daily_units"] == []
    json.dumps(out, allow_nan=False)  # raises if a real NaN slipped through


def test_product_detail_dict_nan_daily_units_becomes_empty_list():
    cand = {
        "product_id": "a",
        "title": "A",
        "config_category": "shapewear",
        "shop_name": "Shop",
        "price": 10.0,
        "commission_rate": 0.1,
        # no daily_units_14 key, and no videos key either
    }
    detail = product_detail_dict(cand, _CATEGORIES_CFG, is_pick=False, has_enrichment=False)
    assert detail["daily_units_14"] == []
    json.dumps(detail, allow_nan=False)


_CATEGORIES_CFG = load_all()["categories"]["categories"]


def test_active_categories_always_includes_core_and_secondary():
    # 2027-03-15: past every seasonal category's one-time scan_end (this
    # config is "re-edit each year" by design, like config/seasons.yaml) --
    # costumes has no scan_start at all ("until Oct 31" with no stated
    # start), so this is the only reliable way to get a date where none of
    # the three seasonal categories are in-window.
    active = active_categories(_CATEGORIES_CFG, date(2027, 3, 15))
    assert set(active) == {
        "shapewear",
        "dresses",
        "sets",
        "furniture",
        "home_decor",
        "winter_clothing",
        "shoes",
        "pet_furniture",
        "home_storage",
    }


def test_active_categories_costumes_only_until_halloween():
    assert "costumes" in active_categories(_CATEGORIES_CFG, date(2026, 10, 31))
    assert "costumes" not in active_categories(_CATEGORIES_CFG, date(2026, 11, 1))


def test_active_categories_pajamas_window():
    assert "pajamas" not in active_categories(_CATEGORIES_CFG, date(2026, 10, 31))
    assert "pajamas" in active_categories(_CATEGORIES_CFG, date(2026, 11, 1))
    assert "pajamas" in active_categories(_CATEGORIES_CFG, date(2026, 12, 20))
    assert "pajamas" not in active_categories(_CATEGORIES_CFG, date(2026, 12, 21))


def test_active_categories_activewear_window_and_pajamas_overlap():
    # 2026-12-15..20 both pajamas and activewear are in-window at once
    active_mid_dec = active_categories(_CATEGORIES_CFG, date(2026, 12, 18))
    assert "pajamas" in active_mid_dec
    assert "activewear" in active_mid_dec
    assert "activewear" in active_categories(_CATEGORIES_CFG, date(2027, 2, 28))
    assert "activewear" not in active_categories(_CATEGORIES_CFG, date(2027, 3, 1))


def test_active_categories_never_includes_bucket_or_unscanned_entries():
    active = active_categories(_CATEGORIES_CFG, date(2027, 3, 15))
    assert "seasonal" not in active
    assert "other" not in active
    assert "beauty_hair" not in active


def test_score_pool_uses_furniture_price_group_not_fashion():
    # the real case this guards against: once furniture joined the target
    # list (2026-10-18), a single global $25-55 sweet spot would score a
    # real $300 bed as a wild outlier -- it must use furniture's $40-400
    # range instead. A crash or a NaN fit_raw would both be real bugs here.
    config = load_all()
    pool = [_full_candidate("1", "Wooden Bed Frame Queen Size", config_category="furniture", price=300.0)]
    creator_stats = _creator_stats(config)
    df = score_pool(pool, config, creator_stats, date(2026, 10, 14))
    assert pd.notna(df.iloc[0]["z_fit"])


def test_tiktok_search_url_encodes_spaces_and_special_chars():
    url = tiktok_search_url("Onyx Silent Vibration Wrist-Worn Device")
    assert url == "https://www.tiktok.com/search?q=Onyx%20Silent%20Vibration%20Wrist-Worn%20Device"


def test_tiktok_search_url_encodes_accents():
    assert tiktok_search_url("Fajas y más") == "https://www.tiktok.com/search?q=Fajas%20y%20m%C3%A1s"
