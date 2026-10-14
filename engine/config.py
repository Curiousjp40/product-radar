"""Loads config/*.yaml into plain dicts for engine/run.py. The pure functions
in engine/*.py still take explicit keyword weights (with defaults mirroring
these files, see CLAUDE.md) -- this module is what actually threads the YAML
values into those calls at runtime, fulfilling instruction 0.6."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


def _load(name: str) -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / name).read_text(encoding="utf-8"))


def load_all() -> dict[str, Any]:
    return {
        "settings": _load("settings.yaml"),
        "creators": _load("creators.yaml"),
        "categories": _load("categories.yaml"),
        "weights": _load("weights.yaml"),
        "seasons": _load("seasons.yaml"),
    }
