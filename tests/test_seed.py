from pathlib import Path

from engine.db import connect
from engine.seed import import_seed_history, load_creator_history

FIXTURE = Path(__file__).parent / "fixtures" / "creator_history_sample.json"


def test_load_creator_history_parses_all_records():
    videos = load_creator_history(FIXTURE)
    assert len(videos) == 12
    assert "roxm___" in {v.creator for v in videos}


def test_load_creator_history_prefers_handle_over_display_name():
    videos = load_creator_history(FIXTURE)
    rx = next(v for v in videos if v.video_id == "rx-001")
    assert rx.creator == "roxm___"


def test_import_seed_history_writes_rows(tmp_path):
    videos = load_creator_history(FIXTURE)
    conn = connect(tmp_path / "radar.db")
    count = import_seed_history(conn, videos)
    assert count == 12
    (n,) = conn.execute("SELECT COUNT(*) FROM creator_videos").fetchone()
    assert n == 12


def test_import_seed_history_is_idempotent(tmp_path):
    videos = load_creator_history(FIXTURE)
    conn = connect(tmp_path / "radar.db")
    import_seed_history(conn, videos)
    import_seed_history(conn, videos)  # re-run should upsert, not duplicate
    (n,) = conn.execute("SELECT COUNT(*) FROM creator_videos").fetchone()
    assert n == 12
