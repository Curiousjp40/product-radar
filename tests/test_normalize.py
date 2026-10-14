import json
from pathlib import Path

import pytest

from engine.normalize import (
    ads_share_pct_from_overview,
    commission_rate_fraction,
    extract_hashtags,
    growth_rate_fraction,
    is_reply_caption,
    lead_counts_from_overview,
    normalize_creator_video,
    normalize_daily_trend,
    normalize_rank_row,
    trend_period_summary,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))["result"]


def test_commission_rate_fraction():
    assert commission_rate_fraction(15) == pytest.approx(0.15)


def test_growth_rate_fraction():
    assert growth_rate_fraction(14.76) == pytest.approx(0.1476)


def test_normalize_rank_row_from_real_fixture():
    result = _load("fastmoss_product_rank_top_selling.json")
    row = result["list"][0]
    product, snapshot = normalize_rank_row(row, week="2026-W41", rank=1, raw_ref="snapshots/2026-W41/shapewear.json")

    assert product.product_id == "1732352660592628585"
    assert product.title.startswith("(KKPeople Easy-Off Bodysuit)")
    assert product.category_l1 == "Womenswear & Underwear"
    assert product.category_l2 == "Women's Underwear"
    assert product.shop_name == "KKpeople Shapewear"
    assert product.delisted is False

    assert snapshot.rank == 1
    assert snapshot.price == pytest.approx(24.9)
    assert snapshot.commission_rate == pytest.approx(0.15)
    assert snapshot.units_7d == 16555
    assert snapshot.gmv_7d == pytest.approx(406859.1)
    assert snapshot.units_total == 120555
    assert snapshot.growth_rate == pytest.approx(0.1476)
    assert snapshot.raw_ref == "snapshots/2026-W41/shapewear.json"


def test_normalize_daily_trend_from_real_fixture():
    result = _load("fastmoss_product_sales_trend.json")
    days = normalize_daily_trend("1732352660592628585", result)
    assert len(days) == 28
    assert days[0].day.isoformat() == "2026-09-17"
    assert days[0].units == 1003
    assert days[-1].day.isoformat() == "2026-10-14"


def test_trend_period_summary_has_creator_and_video_counts():
    result = _load("fastmoss_product_sales_trend.json")
    summary = trend_period_summary(result)
    assert summary["linked_creator_count"] == 769
    assert summary["linked_video_count"] == 465


def test_extract_hashtags():
    assert extract_hashtags("Hello #fajas #shapewear world") == ["fajas", "shapewear"]
    assert extract_hashtags("") == []
    assert extract_hashtags(None) == []


def test_is_reply_caption():
    assert is_reply_caption("Replying to @sandrablevins #faja")
    assert is_reply_caption("Respuesta a @usuario sobre la faja")
    assert not is_reply_caption("Just a regular caption")


def test_normalize_creator_video_from_real_fixture():
    result = _load("fastmoss_creator_video_analysis_roxm___.json")
    row = result["video_list"]["list"][1]  # the SKIN1004 video, has koreanskincare caption
    video = normalize_creator_video(row, "roxm___")

    assert video.video_id == "7696278158391168287"
    assert video.creator == "roxm___"
    assert video.duration_s == 64
    assert video.product_id == "1732416043538092482"
    assert video.views == 21
    assert video.interaction_rate_pct == pytest.approx(4.76)
    assert "koreanskincare" in video.hashtags
    assert video.url == "https://www.tiktok.com/@roxm___/video/7696278158391168287"
    # published_at_ts=1791929409 is confirmed UTC+8 -> America/New_York
    assert video.published_at.tzinfo is not None


def test_ads_share_pct_missing_field_returns_none():
    assert ads_share_pct_from_overview({}) is None
    assert ads_share_pct_from_overview({"ads_distribution": {}}) is None
    assert ads_share_pct_from_overview({"ads_distribution": {"breakdown": []}}) is None


def test_ads_share_pct_from_real_fixture():
    result = _load("fastmoss_product_overview.json")
    assert ads_share_pct_from_overview(result) == 42


def test_lead_counts_from_overview_needs_14_days():
    assert lead_counts_from_overview({"daily_trend": [{}] * 10}) is None


def test_lead_counts_from_real_fixture():
    result = _load("fastmoss_product_overview.json")
    creator_last7, creator_prior7, video_last7, video_prior7 = lead_counts_from_overview(result)
    # last 7 entries: 2026-10-08..10-14; prior 7: 2026-10-01..10-07
    assert creator_last7 == 105 + 116 + 103 + 92 + 103 + 113 + 124
    assert creator_prior7 == 108 + 97 + 105 + 104 + 86 + 111 + 112
    assert video_last7 == 63 + 73 + 65 + 59 + 69 + 85 + 71
    assert video_prior7 == 75 + 45 + 64 + 71 + 43 + 58 + 68
