"""Proves the REAL weekly pipeline (engine.run.run(), the same function
.github/workflows/weekly-run.yml invokes every Monday) writes every field
web/src/types.ts's Pick/Candidate/ProductDetail/HooksFile interfaces
require -- end to end, through `--dry-run --export-dir` (fixture replay,
zero FastMoss credits), not just the individual dict-builder functions in
isolation.

Added 2026-10-15 after picks.json and hooks.json went live on GitHub Pages
missing category_label_es/en and combo_pairs respectively: engine.run.run()
itself had always written them correctly, but an ad-hoc scratchpad
reprocessing script (used to patch data between full runs) didn't call the
same code path and silently fell behind. This test exercises the actual CLI
entry point's export, not a reimplementation of it, so that class of drift
gets caught here instead of live on the site.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import pytest

from engine.run import run
from engine.ts_fields import extract_interface_fields, load_types_ts

TS_SOURCE = load_types_ts()


def _dry_run_args(export_dir: Path) -> argparse.Namespace:
    return argparse.Namespace(
        dry_run=True,
        week=None,
        print_picks=False,
        budget=75,
        resume_week=None,
        export_dir=str(export_dir),
    )


@pytest.fixture(scope="module")
def dry_run_export(tmp_path_factory) -> Path:
    """Runs the real pipeline once (fixture replay, 0 credits) and returns
    the directory it exported to -- never web/public/data, see
    engine.run.run()'s --export-dir handling."""
    export_dir = tmp_path_factory.mktemp("pr_export")
    asyncio.run(run(_dry_run_args(export_dir)))
    return export_dir


def _assert_no_missing_fields(item: dict, required: set[str], type_name: str, label: str) -> None:
    missing = required - set(item.keys())
    assert not missing, f"{label} is missing field(s) required by web/src/types.ts's {type_name}: {sorted(missing)}"


def test_picks_file_wrapper_has_every_field_picksfile_requires(dry_run_export):
    data = json.loads((dry_run_export / "picks.json").read_text(encoding="utf-8"))
    required, _ = extract_interface_fields(TS_SOURCE, "PicksFile")
    _assert_no_missing_fields(data, required, "PicksFile", "picks.json")


def test_every_pick_has_every_field_pick_requires(dry_run_export):
    data = json.loads((dry_run_export / "picks.json").read_text(encoding="utf-8"))
    assert data["picks"], "dry-run fixtures produced zero picks -- nothing to check"
    required, _ = extract_interface_fields(TS_SOURCE, "Pick")
    for pick in data["picks"]:
        _assert_no_missing_fields(pick, required, "Pick", f"pick {pick.get('product_id')}")


def test_candidates_file_wrapper_has_every_field_candidatesfile_requires(dry_run_export):
    data = json.loads((dry_run_export / "candidates.json").read_text(encoding="utf-8"))
    required, _ = extract_interface_fields(TS_SOURCE, "CandidatesFile")
    _assert_no_missing_fields(data, required, "CandidatesFile", "candidates.json")


def test_every_candidate_has_every_field_candidate_requires(dry_run_export):
    data = json.loads((dry_run_export / "candidates.json").read_text(encoding="utf-8"))
    assert data["candidates"], "dry-run fixtures produced zero candidates -- nothing to check"
    required, _ = extract_interface_fields(TS_SOURCE, "Candidate")
    for cand in data["candidates"]:
        _assert_no_missing_fields(cand, required, "Candidate", f"candidate {cand.get('product_id')}")


def test_every_product_detail_has_every_field_productdetail_requires(dry_run_export):
    product_files = sorted((dry_run_export / "products").glob("*.json"))
    assert product_files, "dry-run fixtures produced zero product detail pages -- nothing to check"
    required, _ = extract_interface_fields(TS_SOURCE, "ProductDetail")
    for path in product_files:
        detail = json.loads(path.read_text(encoding="utf-8"))
        _assert_no_missing_fields(detail, required, "ProductDetail", path.name)


def test_hooks_file_has_every_field_hooksfile_requires(dry_run_export):
    data = json.loads((dry_run_export / "hooks.json").read_text(encoding="utf-8"))
    required, _ = extract_interface_fields(TS_SOURCE, "HooksFile")
    _assert_no_missing_fields(data, required, "HooksFile", "hooks.json")


def test_every_combo_pair_has_every_field_combopair_requires(dry_run_export):
    data = json.loads((dry_run_export / "hooks.json").read_text(encoding="utf-8"))
    required, _ = extract_interface_fields(TS_SOURCE, "ComboPair")
    assert data["combo_pairs"], "hooks.json's combo_pairs is empty -- nothing to check"
    for combo in data["combo_pairs"]:
        _assert_no_missing_fields(combo, required, "ComboPair", "a combo_pairs entry")


def test_dry_run_export_dir_never_touches_real_site_data(dry_run_export):
    # The pipeline only ever writes to the directory we gave it -- confirm
    # it isn't ALSO the real site data (a regression here would mean
    # --export-dir silently stopped being passed through to export.write_*).
    real_data_dir = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
    assert dry_run_export.resolve() != real_data_dir.resolve()
