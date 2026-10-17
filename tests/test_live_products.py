import json

import pytest

import engine.images as images_module
import engine.ingest as ingest_module
from engine.budget import BudgetTracker
from engine.client import FixtureReplayClient
from engine.db import connect
from engine.live_products import (
    _combine_live_result,
    estimate_credits,
    investigate_live,
    run_live_products_investigation,
    select_candidate_lives,
)

SHAPEWEAR_LIVE = {
    "room_id": "room_1",
    "title": "Faja live",
    "creator_handle": "fajalinda_shop",
    "started_at": "2026-10-10T20:00:00-04:00",
    "duration_minutes": 75,
    "viewer_count": 9100,
    "units_sold": 142,
    "gmv": 3218.56,
}

HOME_DECOR_LIVE = {
    "room_id": "room_2",
    "title": "Decor live",
    "creator_handle": "casacozyhome",
    "started_at": "2026-10-11T19:30:00-04:00",
    "duration_minutes": 60,
    "viewer_count": 5400,
    "units_sold": 88,
    "gmv": 4120.10,
}

FURNITURE_LIVE = {
    "room_id": "room_3",
    "title": "Mesa live",
    "creator_handle": "muebleshogarusa",
    "started_at": "2026-10-09T21:00:00-04:00",
    "duration_minutes": 95,
    "viewer_count": 2100,
    "units_sold": 19,
    "gmv": 5890.00,
}

OFF_TOPIC_LIVE = {
    "room_id": "room_4",
    "title": "Tea ceremony live",
    "creator_handle": "teatimeasmr",
    "started_at": "2026-10-08T18:00:00-04:00",
    "duration_minutes": 40,
    "viewer_count": 500,
    "units_sold": 300,  # highest units_sold -- would sort first if not excluded
    "gmv": 900.0,
}

@pytest.fixture(autouse=True)
def _isolate_snapshots_dir(tmp_path, monkeypatch):
    """investigate_live now unconditionally writes raw FastMoss responses
    to disk via engine.ingest.save_raw_snapshot (the 2026-10-16 "never
    trim before saving" fix). Every test in this module must never write
    into the repo's real data/snapshots/ directory, so this redirects
    SNAPSHOTS_DIR to a per-test tmp_path automatically."""
    monkeypatch.setattr(ingest_module, "SNAPSHOTS_DIR", tmp_path / "snapshots")
    # cache_image (bug-3 fix: host/product images routed through the
    # existing image-cache helper) does real file I/O into
    # web/public/img/ by default -- redirect it to a per-test tmp dir so
    # no test ever writes into the repo's real image folder.
    monkeypatch.setattr(images_module, "IMG_DIR", tmp_path / "img")


TRACKED_CATEGORIES = {
    "shapewear", "dresses", "sets", "furniture", "home_decor", "winter_clothing",
    "shoes", "pet_furniture", "home_storage", "costumes", "pajamas", "activewear",
}


def make_highlights(extra_categories: dict | None = None) -> dict:
    categories = {
        "shapewear": [SHAPEWEAR_LIVE],
        "home_decor": [HOME_DECOR_LIVE],
        "furniture": [FURNITURE_LIVE],
        # same L1 id as shapewear -- duplicate room_id to test dedup
        "dresses": [SHAPEWEAR_LIVE],
    }
    if extra_categories:
        categories.update(extra_categories)
    return {"schema_version": 1, "categories": categories}


def test_select_candidate_lives_dedupes_by_room_id():
    highlights = make_highlights()
    candidates = select_candidate_lives(highlights, TRACKED_CATEGORIES, already_investigated=set())
    room_ids = [c["room_id"] for c in candidates]
    assert room_ids.count("room_1") == 1


def test_select_candidate_lives_filters_to_tracked_categories():
    highlights = make_highlights(extra_categories={"tea": [OFF_TOPIC_LIVE]})
    candidates = select_candidate_lives(highlights, TRACKED_CATEGORIES, already_investigated=set())
    room_ids = {c["room_id"] for c in candidates}
    assert "room_4" not in room_ids
    assert OFF_TOPIC_LIVE["room_id"] not in room_ids


def test_select_candidate_lives_excludes_already_investigated():
    highlights = make_highlights()
    candidates = select_candidate_lives(highlights, TRACKED_CATEGORIES, already_investigated={"room_1"})
    room_ids = {c["room_id"] for c in candidates}
    assert "room_1" not in room_ids
    assert "room_2" in room_ids


def test_select_candidate_lives_sorts_by_units_sold_desc():
    highlights = make_highlights()
    candidates = select_candidate_lives(highlights, TRACKED_CATEGORIES, already_investigated=set())
    units = [c["units_sold"] for c in candidates]
    assert units == sorted(units, reverse=True)
    assert candidates[0]["room_id"] == "room_1"  # 142 units, the highest


def test_select_candidate_lives_respects_limit():
    highlights = make_highlights()
    candidates = select_candidate_lives(highlights, TRACKED_CATEGORIES, already_investigated=set(), limit=2)
    assert len(candidates) == 2


def test_estimate_credits_charges_3_per_live_plus_1_per_new_creator():
    candidates = [SHAPEWEAR_LIVE, HOME_DECOR_LIVE, FURNITURE_LIVE]
    estimate = estimate_credits(candidates, already_investigated_creators=set())
    assert estimate["lives"] == 3
    assert estimate["new_creators"] == 3
    assert estimate["lives_credits"] == 9
    assert estimate["creator_credits"] == 3
    assert estimate["total_credits"] == 12


def test_estimate_credits_skips_already_cached_creators():
    candidates = [SHAPEWEAR_LIVE, HOME_DECOR_LIVE]
    estimate = estimate_credits(candidates, already_investigated_creators={"fajalinda_shop"})
    assert estimate["new_creators"] == 1
    assert estimate["total_credits"] == 2 * 3 + 1


def _fixture_client() -> FixtureReplayClient:
    return FixtureReplayClient(
        {
            "live_products_list": "fastmoss_live_products_list_shapewear.json",
            "live_detail_analysis": "fastmoss_live_detail_analysis_shapewear.json",
            "creator_search": "fastmoss_creator_search_fajalinda_shop.json",
            "credit_usage_summary": "fastmoss_credit_usage_summary.json",
        }
    )


async def test_investigate_live_parses_expected_shape(tmp_path):
    client = _fixture_client()
    conn = connect(tmp_path / "radar.db")
    tracker = BudgetTracker(hard_cap=100, starting_balance=500, run_id="test", conn=conn)
    async with client:
        result = await investigate_live(client, "room_1", "fajalinda_shop", {}, tracker, conn)
    assert result["room_id"] == "room_1"
    assert result["host"]["handle"] == "fajalinda_shop"
    assert result["host"]["follower_count"] == 184000
    assert result["host"]["day28_gmv"] == 58210.0
    assert result["host"]["top_category"] == "shapewear"
    assert result["viewer_count"] == 9100
    assert result["units_sold"] == 142
    assert result["conversion_rate"] == round(142 / 9100, 4)
    assert len(result["products"]) == 3
    assert result["products"][0]["title"] == "Faja Colombiana Shapewear Short BBL"


def test_combine_live_result_derives_price_when_raw_price_is_zero(tmp_path, monkeypatch):
    """Bug 1 (Ryan's 2026-10-16 report): `price` is confirmed always 0 in
    every real `live_products_list` response, so a real per-unit price
    must be derived from `live_gmv / live_units_sold` instead of trusting
    the raw (always-0) `price` field."""
    monkeypatch.setattr(images_module, "IMG_DIR", tmp_path / "img")
    products_raw = {
        "products": [
            {
                "product_id": "p1",
                "title": "Faja",
                "cover_url": "https://s.500fd.com/tt_product/example.jpg",
                "price": 0,
                "live_gmv": 1829.45,
                "live_units_sold": 61,
                "commission_rate_percent": 18,
                "sales_timeline": [],
            }
        ],
        "total": 1,
    }
    detail_raw = {"performance": {}, "live": {}, "category_breakdown": {}}
    creator_raw = {"list": [{"creator": {}, "commerce_summary": {}}]}
    result = _combine_live_result("room_1", products_raw, detail_raw, creator_raw)
    assert result["products"][0]["price"] == round(1829.45 / 61, 2)
    assert result["products"][0]["price"] != 0


def test_combine_live_result_keeps_real_nonzero_price_if_ever_present(tmp_path, monkeypatch):
    """If a future response ever returns a genuine nonzero `price`, that
    value must win over the derived one -- the derivation is only a
    fallback for the confirmed always-0 case."""
    monkeypatch.setattr(images_module, "IMG_DIR", tmp_path / "img")
    products_raw = {
        "products": [
            {
                "product_id": "p1",
                "title": "Faja",
                "cover_url": "",
                "price": 19.99,
                "live_gmv": 1829.45,
                "live_units_sold": 61,
                "commission_rate_percent": 18,
                "sales_timeline": [],
            }
        ],
        "total": 1,
    }
    detail_raw = {"performance": {}, "live": {}, "category_breakdown": {}}
    creator_raw = {"list": [{"creator": {}, "commerce_summary": {}}]}
    result = _combine_live_result("room_1", products_raw, detail_raw, creator_raw)
    assert result["products"][0]["price"] == 19.99


def test_combine_live_result_proxies_host_and_product_images(tmp_path, monkeypatch):
    """Bug 3 (Ryan's 2026-10-16 report): host photo_url and product
    image_url must be routed through engine.images.cache_image (the same
    helper engine/run.py already uses for product/video thumbnails), not
    left pointing straight at FastMoss's own CDN."""
    img_dir = tmp_path / "img"
    monkeypatch.setattr(images_module, "IMG_DIR", img_dir)
    products_raw = {
        "products": [
            {
                "product_id": "p1",
                "title": "Faja",
                "cover_url": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
                "price": 0,
                "live_gmv": 100.0,
                "live_units_sold": 10,
                "commission_rate_percent": 18,
                "sales_timeline": [],
            }
        ],
        "total": 1,
    }
    detail_raw = {"performance": {}, "live": {}, "category_breakdown": {}}
    creator_raw = {
        "list": [
            {
                "creator": {
                    "unique_id": "fajalinda_shop",
                    "avatar": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
                },
                "commerce_summary": {},
            }
        ]
    }
    result = _combine_live_result("room_1", products_raw, detail_raw, creator_raw)
    assert result["host"]["photo_url"].startswith("/img/")
    assert "s.500fd.com" not in result["host"]["photo_url"]
    assert result["products"][0]["image_url"].startswith("/img/")
    assert "s.500fd.com" not in result["products"][0]["image_url"]


def _non_balance_tool_names(calls: list[tuple[str, dict]]) -> list[str]:
    """`client.calls` records every call made through FixtureReplayClient,
    including the free balance checks BudgetTracker.checkpoint triggers --
    filtered out here so "exactly 3 tool calls" / "exactly 2 tool calls"
    talks about the FastMoss investigation tools the brief cares about,
    not the free bookkeeping calls alongside them."""
    return [name for name, _ in calls if name != "credit_usage_summary"]


async def test_investigate_live_calls_three_tools_on_first_invocation(tmp_path):
    client = _fixture_client()
    conn = connect(tmp_path / "radar.db")
    tracker = BudgetTracker(hard_cap=100, starting_balance=500, run_id="test", conn=conn)
    async with client:
        await investigate_live(client, "room_1", "fajalinda_shop", {}, tracker, conn)
    tool_names = _non_balance_tool_names(client.calls)
    assert tool_names == ["live_products_list", "live_detail_analysis", "creator_search"]
    assert len(tool_names) == 3


async def test_investigate_live_second_call_same_creator_skips_creator_search(tmp_path):
    client = _fixture_client()
    conn = connect(tmp_path / "radar.db")
    tracker = BudgetTracker(hard_cap=100, starting_balance=500, run_id="test", conn=conn)
    creator_cache: dict = {}
    async with client:
        await investigate_live(client, "room_1", "fajalinda_shop", creator_cache, tracker, conn)
        calls_before = len(client.calls)
        await investigate_live(client, "room_1b", "fajalinda_shop", creator_cache, tracker, conn)
        second_call_tool_names = _non_balance_tool_names(client.calls[calls_before:])
    assert second_call_tool_names == ["live_products_list", "live_detail_analysis"]
    assert len(second_call_tool_names) == 2


async def test_investigate_live_persists_raw_snapshots_before_trimming(tmp_path, monkeypatch):
    """Regression test for the 2026-10-16 real pilot bug: the pilot script
    discarded every product but the top 1-3 before any raw FastMoss
    response ever touched disk, so the other products are gone forever.
    This proves investigate_live now writes the FULL raw response from
    each of the three paid calls to data/snapshots/<week>/<name>.json
    (via engine.ingest.save_raw_snapshot) before _combine_live_result (the
    trimming/selection step) ever runs -- so a future "top-N for display"
    step downstream can never again be the only place the full data lived.

    The shapewear fixture has 3 raw products (fastmoss_live_products_
    list_shapewear.json). If this test is run against the ORIGINAL
    investigate_live (no save_raw_snapshot calls), no snapshot files would
    exist at all and this test would fail on the `.exists()` asserts --
    exactly the bug being fixed."""
    monkeypatch.setattr(ingest_module, "SNAPSHOTS_DIR", tmp_path)
    client = _fixture_client()
    conn = connect(tmp_path / "radar.db")
    tracker = BudgetTracker(hard_cap=100, starting_balance=500, run_id="test", conn=conn)
    async with client:
        result = await investigate_live(
            client, "room_1", "fajalinda_shop", {}, tracker, conn, week="2026-W42"
        )

    products_snapshot = tmp_path / "2026-W42" / "liveproducts_room_1_products.json"
    detail_snapshot = tmp_path / "2026-W42" / "liveproducts_room_1_detail.json"
    creator_snapshot = tmp_path / "2026-W42" / "liveproducts_creator_fajalinda_shop.json"
    assert products_snapshot.exists()
    assert detail_snapshot.exists()
    assert creator_snapshot.exists()

    raw_products = json.loads(products_snapshot.read_text(encoding="utf-8"))["products"]
    assert len(raw_products) == 3  # the full fixture response, nothing dropped

    # Simulate the kind of "top-N for display" trimming a UI/export layer
    # might still do downstream -- the point of this test is that the raw
    # snapshot on disk already has strictly more than any such trim, since
    # it was written BEFORE _combine_live_result (and before any caller-side
    # trimming) ever ran.
    downstream_display_products = result["products"][:1]
    assert len(raw_products) > len(downstream_display_products)


async def test_run_live_products_investigation_dry_run_makes_zero_calls(tmp_path):
    client = _fixture_client()
    conn = connect(tmp_path / "radar.db")
    highlights = make_highlights()
    async with client:
        result = await run_live_products_investigation(
            client, conn, highlights, TRACKED_CATEGORIES, already_investigated=set(), run_id="test-liveproducts", dry_run=True
        )
    assert result["dry_run"] is True
    assert len(client.calls) == 0
    assert len(result["candidates"]) == 3  # room_1, room_2, room_3 (room_1 deduped from dresses)
    assert result["estimate"]["lives"] == 3
