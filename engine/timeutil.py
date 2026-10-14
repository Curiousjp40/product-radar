"""Timezone helpers. FastMoss timestamps are confirmed UTC+8 (China Standard
Time) -- proven in docs/field_map.md by matching a seed-file video's
published_at string against the live API's unix timestamp. Any posting-time
analysis (spec section 8.4) should use America/New_York, not UTC+8 and not
naive UTC.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
FASTMOSS_DISPLAY_TZ = ZoneInfo("Etc/GMT-8")  # UTC+8; POSIX TZ names invert the sign


def unix_ts_to_eastern(unix_ts: float) -> datetime:
    """A FastMoss unix timestamp (e.g. `published_at_ts`) is timezone-agnostic
    truth -- convert straight to America/New_York."""
    return datetime.fromtimestamp(unix_ts, tz=EASTERN)


def fastmoss_display_to_eastern(display: str) -> datetime:
    """Parse a FastMoss `*_display` string (confirmed UTC+8, e.g.
    "2026-09-16 06:17:54") and convert to America/New_York."""
    naive = datetime.strptime(display, "%Y-%m-%d %H:%M:%S")
    return naive.replace(tzinfo=FASTMOSS_DISPLAY_TZ).astimezone(EASTERN)


def now_eastern() -> datetime:
    return datetime.now(tz=EASTERN)
