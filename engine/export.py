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
        },
    )
