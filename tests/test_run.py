import json
from datetime import date

import pandas as pd

from engine.config import load_all
from engine.run import (
    REAL_CATEGORY_QUERIES,
    _creator_stats,
    assemble_picks,
    build_reasons,
    candidates_to_export_dicts,
    ingest_from_snapshots,
    partition_suspicious,
    product_detail_dict,
    score_pool,
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


def _weights(core_slots, explore_slots, max_per_category=3, max_per_shop=2):
    return {
        "picks": {
            "core_slots": core_slots,
            "explore_slots": explore_slots,
            "evergreen_slots": 0,
            "max_per_category": max_per_category,
            "max_per_shop": max_per_shop,
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


def test_score_pool_cowboy_costume_matches_halloween_not_black_friday():
    # the real case this guards against: "Play Along Cowboy Costume" is
    # category-tagged "womens_clothing" by FastMoss, which also matches
    # bfcm_2026's broad category list -- Black Friday's boost used to win
    # the scoring comparison and label it "Black Friday in 49 days." Title
    # keywords ("costume") must identify it as Halloween instead, for both
    # the matched event and the reason's day count.
    config = load_all()
    pool = ingest_from_snapshots("2026-W42", list(REAL_CATEGORY_QUERIES))
    pool, _ = partition_suspicious(pool, config["weights"])
    creator_stats = _creator_stats(config)
    today = date(2026, 10, 14)
    df = score_pool(pool, config, creator_stats, today)

    row = df[df["title"] == "Play Along Cowboy Costume"].iloc[0]
    assert row["matched_event_id"] == "halloween_2026"
    assert row["days_to_event_end"] == 17  # 2026-10-31 (Halloween) - 2026-10-14


def _candidate_row(product_id, **overrides):
    base = {
        "product_id": product_id,
        "title": product_id,
        "config_category": "shapewear",
        "shop_name": "Shop",
        "stage": "rising",
        "price": 10.0,
        "commission_rate": 0.1,
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
    out = candidates_to_export_dicts(df)
    assert out[0]["daily_units"] == [1, 2, 3]
    assert out[1]["daily_units"] == []
    json.dumps(out, allow_nan=False)  # raises if a real NaN slipped through


def test_product_detail_dict_nan_daily_units_becomes_empty_list():
    pick = {
        "product_id": "a",
        "title": "A",
        "config_category": "shapewear",
        "shop_name": "Shop",
        "price": 10.0,
        "commission_rate": 0.1,
        "earnings_per_sale": 1.0,
        # no daily_units_14 key, and no videos key either
    }
    detail = product_detail_dict(pick)
    assert detail["daily_units_14"] == []
    json.dumps(detail, allow_nan=False)
