"""Typed models mirroring the SQLite schema in PRODUCT_RADAR_SPEC.md section 5.

These are deliberately generic (not shaped after any FastMoss response). Phase 0's
normalize.py is responsible for mapping real FastMoss fields onto these models.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

SnapshotSource = Literal["top_selling", "rising", "search"]
Stage = Literal["emerging", "rising", "peak", "evergreen", "declining", "new_to_radar"]
PickKind = Literal["core", "explore", "evergreen", "winner_again"]
PipelineStatusName = Literal[
    "shortlisted", "sample_requested", "sample_received", "filmed", "posted", "skipped"
]
FeedbackSignal = Literal["not_for_me", "love_it"]


class Product(BaseModel):
    product_id: str
    title: str
    image_url: str | None = None
    category_l1: str
    category_l2: str | None = None
    shop_id: str
    shop_name: str
    first_seen_week: str  # ISO week, e.g. "2026-W43"
    launch_date: date | None = None
    delisted: bool = False


class ProductSnapshot(BaseModel):
    week: str
    product_id: str
    source: SnapshotSource
    rank: int | None = None
    price: float
    price_min: float | None = None
    price_max: float | None = None
    commission_rate: float
    units_1d: int | None = None
    units_7d: int | None = None
    units_30d: int | None = None
    units_total: int | None = None
    gmv_7d: float | None = None
    gmv_30d: float | None = None
    growth_rate: float | None = None
    creator_count: int | None = None
    video_count: int | None = None
    live_count: int | None = None
    rating: float | None = None
    review_count: int | None = None
    raw_ref: str | None = None


class ProductDaily(BaseModel):
    product_id: str
    day: date
    units: int
    gmv: float


class ProductFeatures(BaseModel):
    week: str
    product_id: str
    demand: float
    slope14: float
    wow: float
    accel: float
    rank_delta: int | None = None
    is_new: bool = False
    earnings_per_sale: float
    demand_per_creator: float
    saturation: float
    stage: Stage
    spanish_share: float | None = None
    risk: float


class Score(BaseModel):
    week: str
    product_id: str
    creator: str
    fit: float
    season: float
    score: int
    ev_typical: float
    ev_upside: float
    components: dict[str, float] = {}
    reasons_es: list[str] = []
    reasons_en: list[str] = []


class Pick(BaseModel):
    week: str
    creator: str
    product_id: str
    slot: int
    kind: PickKind


class CreatorVideo(BaseModel):
    video_id: str
    creator: str  # handle, e.g. "roxm___" -- the key used everywhere else (settings/creators yaml, pipeline, scores)
    published_at: datetime
    duration_s: int
    title: str
    category: str | None = None
    video_type: str | None = None  # e.g. "shop" -- spec section 2 stats are "shop videos only"
    product_id: str | None = None
    views: int
    units: int
    gmv: float
    likes: int
    hashtags: list[str] = []
    format_tags: list[str] = []
    is_reply: bool = False
    url: str | None = None
    interaction_rate_pct: float | None = None


class PipelineStatus(BaseModel):
    creator: str
    product_id: str
    status: PipelineStatusName
    updated_at: datetime
    note: str | None = None


class Feedback(BaseModel):
    creator: str
    product_id: str
    week: str
    signal: FeedbackSignal
    reason: str | None = None


class Outcome(BaseModel):
    creator: str
    product_id: str
    video_id: str
    posted_at: datetime
    predicted_ev: float
    gmv_7d: float | None = None
    gmv_28d: float | None = None
    views_28d: int | None = None


class CreditLedgerEntry(BaseModel):
    ts: datetime
    run_id: str
    tool: str
    credits: int
    ok: bool
    note: str | None = None
