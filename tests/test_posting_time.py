import json
from datetime import UTC, datetime

from engine.posting_time import (
    best_live_time_for_l1,
    best_time_for_pool,
    best_video_time,
    heat_grid_cells,
    load_live_records,
    load_video_records,
    top_lives_for_l1,
)
from engine.run import compute_best_times_by_category_and_group, compute_live_schedule_by_group


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
    records = (
        [{"product_id": "p1", "is_ad": False, "units": 50, "weekday": 0, "hour_start": 12, "hour_end": 14} for _ in range(5)]
        + [{"product_id": "p1", "is_ad": False, "units": 50, "weekday": 2, "hour_start": 12, "hour_end": 14} for _ in range(5)]
        + [{"product_id": "p1", "is_ad": False, "units": 1, "weekday": 1, "hour_start": 12, "hour_end": 14} for _ in range(5)]
    )
    result = best_video_time("p1", "dresses", "fashion", records, {}, {})
    assert set(result["best_weekdays"]) == {0, 2}


def _write_live_snapshot(tmp_path, week, l1_id, page, lives):
    week_dir = tmp_path / week
    week_dir.mkdir(parents=True, exist_ok=True)
    (week_dir / f"live_{l1_id}_p{page}.json").write_text(json.dumps({"list": lives}), encoding="utf-8")


def _live(room_id, started_at, units, duration_seconds=3600):
    return {
        "live": {"room_id": room_id, "started_at": started_at, "duration_seconds": duration_seconds},
        "performance_summary": {"live_units_sold": units},
    }


def test_load_live_records_dedupes_by_room_id_across_pages(tmp_path):
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live("r1", MON_NOON_ET, 10)])
    _write_live_snapshot(tmp_path, "2026-W01", 2, 2, [_live("r1", MON_NOON_ET, 10)])
    records = load_live_records(tmp_path, 2)
    assert len(records) == 1


def test_load_live_records_only_loads_the_given_l1_id(tmp_path):
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live("r1", MON_NOON_ET, 10)])
    _write_live_snapshot(tmp_path, "2026-W01", 20, 1, [_live("r2", MON_NOON_ET, 10)])
    records = load_live_records(tmp_path, 2)
    assert len(records) == 1
    assert records[0]["room_id"] == "r1"


def test_best_live_time_for_l1_includes_median_duration(tmp_path):
    lives = [_live(f"r{i}", MON_NOON_ET, 10, duration_seconds=3600 + i * 60) for i in range(5)]
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, lives)
    records = load_live_records(tmp_path, 2)
    result = best_live_time_for_l1(records)
    assert result["hour_start"] == 12
    assert result["median_duration_minutes"] == 62  # median of 60,61,62,63,64 minutes


def test_best_live_time_for_l1_returns_none_with_no_lives():
    assert best_live_time_for_l1([]) is None


def _live_full(room_id, started_at, units, viewers=100, gmv=50.0, duration_seconds=3600, title="Sale!"):
    return {
        "live": {"room_id": room_id, "started_at": started_at, "duration_seconds": duration_seconds, "title": title},
        "performance_summary": {"live_units_sold": units, "total_viewer_count": viewers, "live_gmv": gmv},
        "creator": {"creator_handle": "roxiecreator"},
    }


_NOW = datetime.fromtimestamp(MON_NOON_ET, tz=UTC)


def test_top_lives_for_l1_sorts_by_units_sold_descending(tmp_path):
    _write_live_snapshot(
        tmp_path,
        "2026-W01",
        2,
        1,
        [_live_full("r1", MON_NOON_ET, units=5), _live_full("r2", MON_NOON_ET, units=20), _live_full("r3", MON_NOON_ET, units=10)],
    )
    result = top_lives_for_l1(tmp_path, 2, _NOW)
    assert [r["room_id"] for r in result] == ["r2", "r3", "r1"]


def test_top_lives_for_l1_includes_viewer_count_and_duration(tmp_path):
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live_full("r1", MON_NOON_ET, units=5, viewers=321, duration_seconds=1800)])
    result = top_lives_for_l1(tmp_path, 2, _NOW)
    assert result[0]["viewer_count"] == 321
    assert result[0]["duration_minutes"] == 30


def test_top_lives_for_l1_excludes_lives_older_than_within_days(tmp_path):
    old_started_at = MON_NOON_ET - 40 * 86_400
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live_full("r1", old_started_at, units=50)])
    result = top_lives_for_l1(tmp_path, 2, _NOW, within_days=28)
    assert result == []


def test_top_lives_for_l1_only_loads_the_given_l1_id(tmp_path):
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live_full("r1", MON_NOON_ET, units=5)])
    _write_live_snapshot(tmp_path, "2026-W01", 20, 1, [_live_full("r2", MON_NOON_ET, units=5)])
    result = top_lives_for_l1(tmp_path, 2, _NOW)
    assert [r["room_id"] for r in result] == ["r1"]


def test_top_lives_for_l1_dedupes_by_room_id_across_pages(tmp_path):
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live_full("r1", MON_NOON_ET, units=5)])
    _write_live_snapshot(tmp_path, "2026-W01", 2, 2, [_live_full("r1", MON_NOON_ET, units=5)])
    result = top_lives_for_l1(tmp_path, 2, _NOW)
    assert len(result) == 1


def test_top_lives_for_l1_respects_limit(tmp_path):
    lives = [_live_full(f"r{i}", MON_NOON_ET, units=i) for i in range(15)]
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, lives)
    result = top_lives_for_l1(tmp_path, 2, _NOW, limit=5)
    assert len(result) == 5


def _rec(weekday, hour_start, units):
    return {
        "room_id": f"r{weekday}-{hour_start}-{units}",
        "units": units,
        "weekday": weekday,
        "hour_start": hour_start,
        "hour_end": hour_start + 2,
    }


def test_heat_grid_cells_groups_by_weekday_and_hour():
    records = [_rec(0, 12, 10), _rec(0, 12, 20), _rec(2, 20, 5)]
    cells = heat_grid_cells(records)
    assert len(cells) == 2
    mon_noon = next(c for c in cells if c["weekday"] == 0 and c["hour_start"] == 12)
    assert mon_noon["median_units"] == 15
    assert mon_noon["sample_size"] == 2
    wed_evening = next(c for c in cells if c["weekday"] == 2 and c["hour_start"] == 20)
    assert wed_evening["median_units"] == 5
    assert wed_evening["sample_size"] == 1
    assert wed_evening["hour_end"] == 22


def test_heat_grid_cells_uses_median_not_mean():
    # one viral live at 500 units shouldn't make the slot look typical of 500
    records = [_rec(1, 8, 10), _rec(1, 8, 12), _rec(1, 8, 500)]
    cells = heat_grid_cells(records)
    assert cells[0]["median_units"] == 12


def test_heat_grid_cells_empty_with_no_records():
    assert heat_grid_cells([]) == []


def test_compute_live_schedule_by_group_pools_member_categories_by_l1_id(tmp_path):
    # shapewear and dresses (both Moda) share L1=2 in the real config;
    # pet_furniture (Mascotas) uses a different id and must stay separate.
    live_timing_cfg = {"category_to_l1_id": {"shapewear": 2, "dresses": 2, "pet_furniture": 17}}
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live("r1", MON_NOON_ET, 10), _live("r2", MON_NOON_ET, 20)])
    _write_live_snapshot(tmp_path, "2026-W01", 17, 1, [_live("r3", MON_NOON_ET, 5)])
    result = compute_live_schedule_by_group(live_timing_cfg, snapshots_dir=tmp_path)
    assert result["moda"]["sample_size"] == 2
    assert result["mascotas"]["sample_size"] == 1
    assert result["zapatos"]["sample_size"] == 0
    assert result["zapatos"]["best"] is None
    assert result["moda"]["best"]["hour_start"] == 12
    assert len(result["moda"]["grid"]) == 1
    assert result["moda"]["grid"][0]["median_units"] == 15


def test_compute_live_schedule_by_group_dedupes_room_id_across_shared_l1_categories(tmp_path):
    # shapewear and dresses both map to L1=2 -- load_live_records already
    # dedupes within one L1 id's own files, so pooling the group must not
    # double-count a live just because two member categories share an id.
    live_timing_cfg = {"category_to_l1_id": {"shapewear": 2, "dresses": 2}}
    _write_live_snapshot(tmp_path, "2026-W01", 2, 1, [_live("r1", MON_NOON_ET, 10)])
    result = compute_live_schedule_by_group(live_timing_cfg, snapshots_dir=tmp_path)
    assert result["moda"]["sample_size"] == 1
