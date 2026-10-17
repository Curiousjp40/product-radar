"""Validates engine.seed and engine.insights against the REAL
data/seed/creator_history.json (not the synthetic tests/fixtures one).

The expected numbers here are transcribed from PRODUCT_RADAR_SPEC.md section
2.1 ("What their sales history says") -- this file is as much a spec-compliance
check as a unit test: if it fails, either the real data changed or a parsing/
filtering bug crept in between the raw JSON and engine.insights.summarize_creator.
"""

from pathlib import Path

import pytest

from engine.insights import summarize_creator
from engine.seed import load_creator_history, shop_videos_only

REAL_SEED = Path(__file__).parent.parent / "data" / "seed" / "creator_history.json"

pytestmark = pytest.mark.skipif(not REAL_SEED.exists(), reason="real seed data not present")


@pytest.fixture(scope="module")
def all_videos():
    return load_creator_history(REAL_SEED)


def test_real_seed_has_100_videos_50_per_creator(all_videos):
    assert len(all_videos) == 100
    assert sum(1 for v in all_videos if v.creator == "roxm___") == 50
    assert sum(1 for v in all_videos if v.creator == "ariannamendoza04") == 50


def test_real_seed_has_four_non_shop_videos(all_videos):
    # spec section 2: "Shop videos only" -- Roxie 46 shop + Ari 50 shop = 96,
    # so the remaining 4 of the 100 total are non-shop (confirmed: all Roxie's).
    non_shop = [v for v in all_videos if v not in shop_videos_only(all_videos)]
    assert len(non_shop) == 4
    assert all(v.creator == "roxm___" for v in non_shop)


def test_roxie_shop_video_summary_matches_spec_section_2_1(all_videos):
    roxie = shop_videos_only([v for v in all_videos if v.creator == "roxm___"])
    assert len(roxie) == 46
    s = summarize_creator(roxie)
    assert s["gmv"] == pytest.approx(21_319, abs=1)
    assert s["units"] == 1212
    assert s["views"] == pytest.approx(1_963_471, abs=5000)
    assert s["median_views_per_video"] == pytest.approx(3683, abs=1)
    assert s["median_gmv_per_video"] == pytest.approx(44, abs=1)
    assert s["avg_price_per_unit"] == pytest.approx(17.59, abs=0.01)
    assert s["units_per_10k_views"] == pytest.approx(6.17, abs=0.01)
    assert s["gmv_per_1k_views"] == pytest.approx(10.86, abs=0.01)
    assert s["gmv_top1_share"] == pytest.approx(0.45, abs=0.01)
    assert s["gmv_top5_share"] == pytest.approx(0.76, abs=0.01)


