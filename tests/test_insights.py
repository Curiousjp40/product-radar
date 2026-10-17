from pathlib import Path

import pytest

from engine.insights import (
    format_tag_breakdown,
    hit_tracker,
    length_bucket,
    length_sweet_spot,
    reach_vs_engagement,
    summarize_creator,
)
from engine.seed import load_creator_history

FIXTURE = Path(__file__).parent / "fixtures" / "creator_history_sample.json"


@pytest.fixture
def roxie_videos():
    videos = load_creator_history(FIXTURE)
    return [v for v in videos if v.creator == "roxm___"]


def test_length_bucket_boundaries():
    assert length_bucket(12) == "<=12s"
    assert length_bucket(13) == "13-20s"
    assert length_bucket(20) == "13-20s"
    assert length_bucket(21) == "21-30s"
    assert length_bucket(30) == "21-30s"
    assert length_bucket(31) == "31s+"


def test_length_sweet_spot_empty_input():
    assert length_sweet_spot([]) == {}


def test_length_sweet_spot_groups_by_bucket(roxie_videos):
    out = length_sweet_spot(roxie_videos)
    assert set(out.keys()) <= {"<=12s", "13-20s", "21-30s", "31s+"}
    for bucket_stats in out.values():
        assert bucket_stats["video_count"] > 0
        assert bucket_stats["gmv_per_video"] >= 0


def test_reach_vs_engagement_too_few_videos():
    assert reach_vs_engagement([]) == {"views_gmv_corr": None, "interaction_rate_gmv_corr": None}


def test_reach_vs_engagement_returns_correlations(roxie_videos):
    out = reach_vs_engagement(roxie_videos)
    assert -1.0 <= out["views_gmv_corr"] <= 1.0
    assert -1.0 <= out["interaction_rate_gmv_corr"] <= 1.0


def test_hit_tracker_shares_sum_sensibly(roxie_videos):
    out = hit_tracker(roxie_videos)
    assert 0.0 <= out["gmv_top1_share"] <= out["gmv_top5_share"] <= 1.0
    assert out["videos_per_week"] > 0


def test_hit_tracker_empty_input():
    out = hit_tracker([])
    assert out == {"gmv_top1_share": 0.0, "gmv_top5_share": 0.0, "videos_per_week": 0.0}


def test_format_tag_breakdown_tags_replies(roxie_videos):
    out = format_tag_breakdown(roxie_videos)
    assert "reply" in out
    assert out["reply"]["video_count"] == 1  # rx-004 is the only is_reply=true video


def test_summarize_creator_matches_known_totals(roxie_videos):
    s = summarize_creator(roxie_videos)
    assert s["video_count"] == 6
    assert s["gmv"] == pytest.approx(9499 + 1200 + 48 + 900 + 39 + 2178)
    assert s["units"] == 180 + 40 + 12 + 30 + 3 + 55
    assert s["avg_price_per_unit"] == pytest.approx(s["gmv"] / s["units"])


def test_summarize_creator_empty_input():
    s = summarize_creator([])
    assert s["video_count"] == 0
    assert s["gmv"] == 0.0
