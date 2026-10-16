"""SQLite schema, copied from PRODUCT_RADAR_SPEC.md section 5."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    product_id TEXT PRIMARY KEY,
    title TEXT,
    image_url TEXT,
    category_l1 TEXT,
    category_l2 TEXT,
    shop_id TEXT,
    shop_name TEXT,
    first_seen_week TEXT,
    launch_date TEXT,
    delisted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_snapshots (
    week TEXT,
    product_id TEXT,
    source TEXT,
    rank INTEGER,
    price REAL,
    price_min REAL,
    price_max REAL,
    commission_rate REAL,
    units_1d INTEGER,
    units_7d INTEGER,
    units_30d INTEGER,
    units_total INTEGER,
    gmv_7d REAL,
    gmv_30d REAL,
    growth_rate REAL,
    creator_count INTEGER,
    video_count INTEGER,
    live_count INTEGER,
    rating REAL,
    review_count INTEGER,
    raw_ref TEXT,
    PRIMARY KEY (week, product_id, source)
);

CREATE TABLE IF NOT EXISTS product_daily (
    product_id TEXT,
    day TEXT,
    units INTEGER,
    gmv REAL,
    PRIMARY KEY (product_id, day)
);

CREATE TABLE IF NOT EXISTS product_features (
    week TEXT,
    product_id TEXT,
    demand REAL,
    slope14 REAL,
    wow REAL,
    accel REAL,
    rank_delta INTEGER,
    is_new INTEGER,
    earnings_per_sale REAL,
    demand_per_creator REAL,
    saturation REAL,
    stage TEXT,
    spanish_share REAL,
    risk REAL,
    PRIMARY KEY (week, product_id)
);

CREATE TABLE IF NOT EXISTS scores (
    week TEXT,
    product_id TEXT,
    creator TEXT,
    fit REAL,
    season REAL,
    score INTEGER,
    ev_typical REAL,
    ev_upside REAL,
    components_json TEXT,
    reasons_es TEXT,
    reasons_en TEXT,
    PRIMARY KEY (week, product_id, creator)
);

CREATE TABLE IF NOT EXISTS picks (
    week TEXT,
    creator TEXT,
    product_id TEXT,
    slot INTEGER,
    kind TEXT,
    PRIMARY KEY (week, creator, product_id)
);

CREATE TABLE IF NOT EXISTS creator_videos (
    video_id TEXT PRIMARY KEY,
    creator TEXT,
    published_at TEXT,
    duration_s INTEGER,
    title TEXT,
    category TEXT,
    product_id TEXT,
    views INTEGER,
    units INTEGER,
    gmv REAL,
    likes INTEGER,
    format_tags TEXT,
    last_updated TEXT
);

CREATE TABLE IF NOT EXISTS pipeline (
    creator TEXT,
    product_id TEXT,
    status TEXT,
    updated_at TEXT,
    note TEXT,
    PRIMARY KEY (creator, product_id)
);

CREATE TABLE IF NOT EXISTS feedback (
    creator TEXT,
    product_id TEXT,
    week TEXT,
    signal TEXT,
    reason TEXT
);

CREATE TABLE IF NOT EXISTS outcomes (
    creator TEXT,
    product_id TEXT,
    video_id TEXT,
    posted_at TEXT,
    predicted_ev REAL,
    gmv_7d REAL,
    gmv_28d REAL,
    views_28d INTEGER
);

CREATE TABLE IF NOT EXISTS credit_ledger (
    ts TEXT,
    run_id TEXT,
    tool TEXT,
    credits INTEGER,
    ok INTEGER,
    note TEXT
);

-- Part C8, added 2026-10-16: Mis Productos' own record of what Roxie
-- requested/received/filmed/posted and what it actually earned -- the
-- real-world outcome data Phase 3 needs to someday re-fit the scoring
-- weights against. Synced from the Worker's KV (web/src/misProductos.ts's
-- source of truth), one row per Mis Productos item, upserted by its own
-- id every weekly run. No re-fitting happens yet; this just collects.
CREATE TABLE IF NOT EXISTS mis_productos_earnings (
    item_id TEXT PRIMARY KEY,
    product_id TEXT,
    name TEXT,
    category TEXT,
    status TEXT,
    date_requested TEXT,
    date_received TEXT,
    units INTEGER,
    earnings REAL,
    video_links TEXT,
    synced_at TEXT
);
"""


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Open (creating if needed) the radar SQLite DB with the full schema applied."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn
