"""Import data/seed/creator_history.json (spec section 4.2) into the
creator_videos table. Real data -- never fabricate or edit it by hand.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from engine.models import CreatorVideo

# Confirmed from the real data/seed/creator_history.json (video_type field):
# spec section 2's totals are "shop videos only" -- filtering to this value
# reproduces section 2.1's reported numbers exactly (46 Roxie shop videos).
SHOP_VIDEO_TYPE = "Shoppable Video"

# creator_history.json is read-only (per CLAUDE.md) and still has rows from
# the old Ari benchmark alongside Roxie's; load_creator_history keeps parsing
# every record (so existing tests/fixtures with multiple creators still work),
# but every real caller filters to this one.
PRIMARY_CREATOR = "roxm___"


def shop_videos_only(videos: list[CreatorVideo]) -> list[CreatorVideo]:
    return [v for v in videos if v.video_type == SHOP_VIDEO_TYPE]


def _record_to_video(record: dict) -> CreatorVideo:
    """Map a raw JSON record onto CreatorVideo.

    Prefers `handle` over `creator` for the `creator` field, since every other
    table in this system keys creators by handle (e.g. "roxm___"), not display
    name (e.g. "Roxie") -- but falls back to `creator` if `handle` is absent,
    since the exact key the real export uses hasn't been confirmed yet.
    """
    data = dict(record)
    handle = data.pop("handle", None)
    creator = handle or data.get("creator")
    if creator is None:
        raise ValueError(f"record has neither 'handle' nor 'creator': {record!r}")
    data["creator"] = creator
    return CreatorVideo.model_validate(data)


def load_creator_history(path: str | Path) -> list[CreatorVideo]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"expected a JSON list of video records, got {type(raw).__name__}")
    return [_record_to_video(r) for r in raw]


def import_seed_history(conn: sqlite3.Connection, videos: list[CreatorVideo]) -> int:
    """Upsert `videos` into creator_videos, keyed by video_id. Returns the
    number of rows written."""
    rows = [
        (
            v.video_id,
            v.creator,
            v.published_at.isoformat(),
            v.duration_s,
            v.title,
            v.category,
            v.product_id,
            v.views,
            v.units,
            v.gmv,
            v.likes,
            json.dumps(v.format_tags + ([] if not v.is_reply else ["reply"])),
            v.published_at.isoformat(),
        )
        for v in videos
    ]
    conn.executemany(
        """
        INSERT INTO creator_videos (
            video_id, creator, published_at, duration_s, title, category,
            product_id, views, units, gmv, likes, format_tags, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
            creator=excluded.creator, published_at=excluded.published_at,
            duration_s=excluded.duration_s, title=excluded.title,
            category=excluded.category, product_id=excluded.product_id,
            views=excluded.views, units=excluded.units, gmv=excluded.gmv,
            likes=excluded.likes, format_tags=excluded.format_tags,
            last_updated=excluded.last_updated
        """,
        rows,
    )
    conn.commit()
    return len(rows)
