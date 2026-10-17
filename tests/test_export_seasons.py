"""engine.export.write_seasons (design review section 0 items 7/8, added
2026-10-16): web/public/data/seasons.json had gone stale -- nothing in the
pipeline ever wrote it, so the Season page showed raw pre-category-rework
keys and no event_date. This writes it straight from config/seasons.yaml's
event dicts.
"""

from __future__ import annotations

import json
from pathlib import Path

from engine.export import write_seasons


def test_write_seasons_picks_the_frontend_fields(tmp_path: Path) -> None:
    events = [
        {
            "id": "halloween_2026",
            "label_es": "Halloween",
            "label_en": "Halloween",
            "categories": ["costumes"],
            "film_start": "2026-09-10",
            "film_end": "2026-10-20",
            "event_date": "2026-10-31",
            "max_picks": 1,  # engine-only field, must not leak into the JSON
            "title_keywords": ["costume"],  # engine-only field, must not leak
        }
    ]
    write_seasons(events, data_dir=tmp_path)
    data = json.loads((tmp_path / "seasons.json").read_text(encoding="utf-8"))
    assert data["events"] == [
        {
            "id": "halloween_2026",
            "label_es": "Halloween",
            "label_en": "Halloween",
            "categories": ["costumes"],
            "film_start": "2026-09-10",
            "film_end": "2026-10-20",
            "event_date": "2026-10-31",
        }
    ]


def test_write_seasons_handles_missing_optional_fields(tmp_path: Path) -> None:
    events = [{"id": "tbd_event", "label_es": "Por confirmar", "label_en": "TBD", "categories": []}]
    write_seasons(events, data_dir=tmp_path)
    data = json.loads((tmp_path / "seasons.json").read_text(encoding="utf-8"))
    event = data["events"][0]
    assert event["film_start"] is None
    assert event["film_end"] is None
    assert event["event_date"] is None
    assert "notes_es" not in event
    assert "notes_en" not in event


def test_write_seasons_includes_notes_when_present(tmp_path: Path) -> None:
    events = [
        {
            "id": "mothers_day_2027",
            "label_es": "Día de las Madres",
            "label_en": "Mother's Day",
            "categories": ["home_decor"],
            "notes_es": "Día de las Madres EEUU 2027-05-09",
            "notes_en": "US Mother's Day 2027-05-09",
        }
    ]
    write_seasons(events, data_dir=tmp_path)
    data = json.loads((tmp_path / "seasons.json").read_text(encoding="utf-8"))
    assert data["events"][0]["notes_es"] == "Día de las Madres EEUU 2027-05-09"
    assert data["events"][0]["notes_en"] == "US Mother's Day 2027-05-09"
