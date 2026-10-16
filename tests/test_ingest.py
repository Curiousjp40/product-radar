from datetime import date

import engine.ingest as ingest_module
from engine.ingest import find_recent_snapshot, save_raw_snapshot


def test_find_recent_snapshot_reuses_current_week(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest_module, "SNAPSHOTS_DIR", tmp_path)
    today = date(2026, 10, 15)  # 2026-W42
    save_raw_snapshot("2026-W42", "videos_1", {"from": "this week"})
    assert find_recent_snapshot("videos_1", today) == {"from": "this week"}


def test_find_recent_snapshot_falls_back_to_a_previous_week(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest_module, "SNAPSHOTS_DIR", tmp_path)
    today = date(2026, 10, 15)  # 2026-W42
    save_raw_snapshot("2026-W40", "videos_1", {"from": "2 weeks ago"})
    assert find_recent_snapshot("videos_1", today, max_weeks_old=4) == {"from": "2 weeks ago"}


def test_find_recent_snapshot_prefers_the_most_recent_week(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest_module, "SNAPSHOTS_DIR", tmp_path)
    today = date(2026, 10, 15)  # 2026-W42
    save_raw_snapshot("2026-W40", "videos_1", {"from": "2 weeks ago"})
    save_raw_snapshot("2026-W41", "videos_1", {"from": "1 week ago"})
    assert find_recent_snapshot("videos_1", today, max_weeks_old=4) == {"from": "1 week ago"}


def test_find_recent_snapshot_ignores_a_snapshot_older_than_the_window(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest_module, "SNAPSHOTS_DIR", tmp_path)
    today = date(2026, 10, 15)  # 2026-W42
    save_raw_snapshot("2026-W36", "videos_1", {"from": "6 weeks ago"})  # outside a 4-week window
    assert find_recent_snapshot("videos_1", today, max_weeks_old=4) is None


def test_find_recent_snapshot_none_when_nothing_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest_module, "SNAPSHOTS_DIR", tmp_path)
    assert find_recent_snapshot("videos_999", date(2026, 10, 15)) is None
