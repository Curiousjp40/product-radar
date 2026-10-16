import json

from engine.posting_time import best_time_for_pool, best_video_time, load_video_records
from engine.run import compute_best_times_by_category_and_group


def _write_snapshot(tmp_path, week, product_id, videos):
    week_dir = tmp_path / week
    week_dir.mkdir(parents=True, exist_ok=True)
    (week_dir / f"videos_{product_id}.json").write_text(
        json.dumps({"product_id": product_id, "videos": videos}), encoding="utf-8"
    )


def _video(video_id, published_at, units, is_ad=False):
    return {
        "video_id": video_id,
        "traffic_flags": {"is_ad": is_ad},
        "product_contribution": {"window_units_sold": units},
        "video_meta": {"published_at": published_at},
    }


# 2026-01-05 is a Monday. 12:00 ET (EST, UTC-5) on that day:
MON_NOON_ET = 1767632400


def test_load_video_records_dedupes_by_video_id_across_weeks(tmp_path):
    _write_snapshot(tmp_path, "2026-W01", "p1", [_video("v1", MON_NOON_ET, 10)])
    _write_snapshot(tmp_path, "2026-W02", "p1", [_video("v1", MON_NOON_ET, 10)])
    records = load_video_records(tmp_path)
    assert len(records) == 1


def test_load_video_records_converts_to_america_new_york(tmp_path):
    _write_snapshot(tmp_path, "2026-W01", "p1", [_video("v1", MON_NOON_ET, 10)])
    records = load_video_records(tmp_path)
    assert records[0]["weekday"] == 0  # Monday
    assert records[0]["hour_start"] == 12


def test_best_video_time_uses_product_level_when_5_or_more(tmp_path):
    videos = [_video(f"v{i}", MON_NOON_ET, 10) for i in range(5)]
    _write_snapshot(tmp_path, "2026-W01", "p1", videos)
    records = load_video_records(tmp_path)
    result = best_video_time("p1", "dresses", "fashion", records, {}, {})
    assert result["basis_level"] == "product"
    assert result["sample_size"] == 5


def test_best_video_time_falls_back_to_category_when_product_has_too_few(tmp_path):
    # p1 has only 2 of its own videos; the category pool (p1+p2) has 30+.
    videos_p1 = [_video("v1", MON_NOON_ET, 10), _video("v2", MON_NOON_ET, 10)]
    videos_p2 = [_video(f"v{i}", MON_NOON_ET, 10) for i in range(3, 33)]
    _write_snapshot(tmp_path, "2026-W01", "p1", videos_p1)
    _write_snapshot(tmp_path, "2026-W01", "p2", videos_p2)
    records = load_video_records(tmp_path)
    category_of = {"p1": "dresses", "p2": "dresses"}
    result = best_video_time("p1", "dresses", "fashion", records, category_of, {})
    assert result["basis_level"] == "category"
    assert result["sample_size"] == 32


def test_best_video_time_ranks_window_by_median_not_sum(tmp_path):
    # One huge outlier at 4am shouldn't make 4am "best" over a consistent
    # noon window with many median-10 videos.
    outlier_4am = MON_NOON_ET - 8 * 3600  # 4 AM ET same day
    videos = (
        [_video("outlier", outlier_4am, 10_000)]
        + [_video(f"v{i}", MON_NOON_ET, 10) for i in range(5)]
    )
    _write_snapshot(tmp_path, "2026-W01", "p1", videos)
    records = load_video_records(tmp_path)
    result = best_video_time("p1", "dresses", "fashion", records, {}, {})
    assert result["hour_start"] == 12


def test_best_video_time_prefers_organic_once_enough_organic_samples(tmp_path):
    organic = [_video(f"o{i}", MON_NOON_ET, 10, is_ad=False) for i in range(30)]
    ads = [_video(f"a{i}", MON_NOON_ET, 10, is_ad=True) for i in range(5)]
    _write_snapshot(tmp_path, "2026-W01", "p1", organic + ads)
    records = load_video_records(tmp_path)
    result = best_video_time("p1", "dresses", "fashion", records, {}, {})
    assert result["used_organic_only"] is True
    assert result["sample_size"] == 30


def test_best_video_time_returns_none_with_no_videos_anywhere():
    result = best_video_time("p1", "dresses", "fashion", [], {}, {})
    assert result is None


def test_best_time_for_pool_returns_none_for_an_empty_pool():
    assert best_time_for_pool([]) is None


def test_best_time_for_pool_summarizes_without_a_fallback_ladder():
    records = [{"product_id": "p", "is_ad": False, "units": 10, "weekday": 0, "hour_start": 12, "hour_end": 14} for _ in range(5)]
    result = best_time_for_pool(records)
    assert result["hour_start"] == 12
    assert result["sample_size"] == 5


def test_compute_best_times_by_category_and_group(tmp_path):
    videos = [_video(f"v{i}", MON_NOON_ET, 10) for i in range(5)]
    _write_snapshot(tmp_path, "2026-W01", "p1", videos)
    pool = [{"product_id": "p1", "config_category": "shapewear"}]
    categories_cfg = {"shapewear": {"group": "fashion"}, "furniture": {"group": "home"}}
    by_category, by_group = compute_best_times_by_category_and_group(pool, categories_cfg, snapshots_dir=tmp_path)
    assert by_category["shapewear"]["hour_start"] == 12
    assert by_category["furniture"] is None
    assert by_group["fashion"]["hour_start"] == 12
    assert by_group["home"] is None


def test_best_video_time_ranks_top_two_weekdays():
    # Monday (weekday 0) and a Wednesday (weekday 2) both get high median
    # units; Tuesday gets low -- top 2 should be Monday and Wednesday.
    wed_noon = MON_NOON_ET + 2 * 86400
    tue_noon = MON_NOON_ET + 86400
    records = (
        [{"product_id": "p1", "is_ad": False, "units": 50, "weekday": 0, "hour_start": 12, "hour_end": 14} for _ in range(5)]
        + [{"product_id": "p1", "is_ad": False, "units": 50, "weekday": 2, "hour_start": 12, "hour_end": 14} for _ in range(5)]
        + [{"product_id": "p1", "is_ad": False, "units": 1, "weekday": 1, "hour_start": 12, "hour_end": 14} for _ in range(5)]
    )
    result = best_video_time("p1", "dresses", "fashion", records, {}, {})
    assert set(result["best_weekdays"]) == {0, 2}
