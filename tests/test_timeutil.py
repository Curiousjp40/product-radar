from datetime import datetime

from engine.timeutil import EASTERN, fastmoss_display_to_eastern, unix_ts_to_eastern


def test_unix_ts_matches_known_fixture():
    # the exact video from docs/field_map.md's timezone proof
    dt = unix_ts_to_eastern(1762439575)
    # UTC 2025-11-06 14:32:55 -> America/New_York (EST, UTC-5 in November) 09:32:55
    assert dt.astimezone(EASTERN) == datetime(2025, 11, 6, 9, 32, 55, tzinfo=EASTERN)


def test_fastmoss_display_to_eastern_matches_unix_ts():
    from_display = fastmoss_display_to_eastern("2025-11-06 22:32:55")
    from_ts = unix_ts_to_eastern(1762439575)
    assert from_display == from_ts


def test_handles_dst_transition():
    # 2026-07-01 is EDT (UTC-4), 2026-01-01 is EST (UTC-5) -- just confirm
    # the conversion doesn't blow up and offsets differ across the DST boundary.
    summer = fastmoss_display_to_eastern("2026-07-01 12:00:00")
    winter = fastmoss_display_to_eastern("2026-01-01 12:00:00")
    assert summer.utcoffset() != winter.utcoffset()
