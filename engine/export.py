"""Writes the dashboard's JSON data contract (spec section 10) to
web/public/data/*.json -- the real (non-sample) paths, so web/src/api.ts
picks these up automatically instead of falling back to synthetic samples.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "data"

SCHEMA_VERSION = 1


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def write_picks(week: str, creator: str, picks: list[dict[str, Any]], data_dir: Path | None = None) -> None:
    _write(
        (data_dir or DATA_DIR) / "picks.json",
        {"schema_version": SCHEMA_VERSION, "week": week, "creator": creator, "picks": picks},
    )


def write_candidates(week: str, candidates: list[dict[str, Any]], data_dir: Path | None = None) -> None:
    _write(
        (data_dir or DATA_DIR) / "candidates.json",
        {"schema_version": SCHEMA_VERSION, "week": week, "candidates": candidates},
    )


def write_product(product_id: str, detail: dict[str, Any], data_dir: Path | None = None) -> None:
    _write((data_dir or DATA_DIR) / "products" / f"{product_id}.json", {"schema_version": SCHEMA_VERSION, **detail})


def write_best_times(
    categories: dict[str, dict | None],
    groups: dict[str, dict | None],
    live: dict[str, dict | None] | None = None,
    data_dir: Path | None = None,
) -> None:
    """Part C7c's Mas -> "Mejores horas" page: a per-category and per-group
    breakdown of best_video_time (engine/posting_time.py), computed once at
    export time rather than making the frontend re-derive it from every
    product's own best_video_time. `live` (Part C7b, added 2026-10-16) is
    the same shape keyed by category, from the monthly live_search pull --
    None/omitted until engine.live_backfill has run at least once."""
    _write(
        (data_dir or DATA_DIR) / "best_times.json",
        {"schema_version": SCHEMA_VERSION, "categories": categories, "groups": groups, "live": live or {}},
    )


def write_live_highlights(highlights: dict[str, list[dict]], data_dir: Path | None = None) -> None:
    """Part 7 "En vivo" (2026-10-16): top-selling lives per category over
    the last 28 days (engine.posting_time.top_lives_for_l1, aggregated by
    engine.run.compute_live_highlights_by_category) -- a separate file
    from best_times.json since this is a per-category LIST of individual
    lives, not a single best-window summary."""
    _write(
        (data_dir or DATA_DIR) / "live_highlights.json",
        {"schema_version": SCHEMA_VERSION, "categories": highlights},
    )


def write_live_schedule(schedule_by_group: dict[str, dict], data_dir: Path | None = None) -> None:
    """Part B Horarios rebuild (2026-10-16): the day x 2-hour heat grid
    per SCHEDULE_GROUPS key (moda/zapatos/muebles/hogar/mascotas), from
    engine.run.compute_live_schedule_by_group -- replaces best_times.json's
    "live" section (one card per category, 12 duplicates across shared L1
    ids) with one card per real group."""
    _write(
        (data_dir or DATA_DIR) / "live_schedule.json",
        {"schema_version": SCHEMA_VERSION, "groups": schedule_by_group},
    )


def write_live_products(by_room: dict[str, dict[str, Any]], data_dir: Path | None = None) -> None:
    """"Lives que venden" paid investigation (2026-10-16, dry-run/fixture
    stage -- see engine/live_products.py): one entry per investigated
    room_id, keyed exactly like live_highlights.json's lives but with the
    full paid breakdown attached. Committed as {"lives": {}} (empty) until
    a human-approved real pilot actually runs -- see CLAUDE.md.

    Shape per room_id:
      host: {handle, photo_url, follower_count, day28_gmv, top_category}
        -- day28_gmv/top_category come from creator_search, cached per
        handle (engine.live_products.investigate_live), not re-fetched
        per live.
      started_at, duration_minutes, viewer_count, units_sold, gmv: same
        concepts as live_highlights.json's per-live rows, but from the
        paid live_detail_analysis call instead of the free live_search
        pull.
      conversion_rate: units_sold / viewer_count, COMPUTED here (not a
        FastMoss field) since live_detail_analysis's description doesn't
        promise one directly.
      category_breakdown: list of {category, units_sold_share_percent}
        from live_detail_analysis.
      sales_timeline: live_products_list's own timeline, if present
        (only when pagesize<=10, which engine.live_products always uses).
      products: list of {product_id, title, image_url, price,
        commission_rate, units_sold} from live_products_list.
    """
    _write(
        (data_dir or DATA_DIR) / "live_products.json",
        {"schema_version": SCHEMA_VERSION, "lives": by_room},
    )


def write_hooks(hooks_cfg: dict[str, Any], data_dir: Path | None = None) -> None:
    """config/hooks.yaml -> web/public/data/hooks.json (Part C, added
    2026-10-15) -- static template content (category hooks + shot-list
    archetypes), not per-week data, but exported the same way so the
    frontend never needs to parse YAML."""
    _write((data_dir or DATA_DIR) / "hooks.json", {"schema_version": SCHEMA_VERSION, **hooks_cfg})


def write_meta(
    week: str,
    run_id: str,
    credits_used_this_run: int,
    credits_used_this_week: int,
    credits_used_month: int,
    credits_balance: int,
    weights_version: str = "0.2.0-lead-ads-audience",
    data_dir: Path | None = None,
    avg_credits_per_run: float | None = None,
) -> None:
    _write(
        (data_dir or DATA_DIR) / "meta.json",
        {
            "schema_version": SCHEMA_VERSION,
            "run_at": datetime.now().astimezone().isoformat(),
            "week": week,
            "run_id": run_id,
            "credits_used_this_run": credits_used_this_run,
            # added 2026-10-15: the full week's spend across every run_id for
            # it (an initial ingest plus any --resume-week re-scores), not
            # just this one invocation's delta -- a resumed re-score showing
            # "0" for itself was being misread as "this week cost nothing."
            "credits_used_this_week": credits_used_this_week,
            "credits_used_month": credits_used_month,
            "credits_balance": credits_balance,
            "weights_version": weights_version,
            # added 2026-10-16: fixes the Mas credits widget showing
            # "~2071 credits/week" (that was total_consumed_credits divided
            # by time-since-plan-start, not a per-run average at all). This
            # is computed server-side from the local credit_ledger (see
            # engine.budget.average_credits_per_run) since the Worker/
            # frontend have no access to that SQLite table.
            "avg_credits_per_run": avg_credits_per_run,
        },
    )
