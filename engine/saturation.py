"""Saturation badge, Part E of the 2026-10-15 creator-workflow upgrade.

The spec frames this as "units growing faster than creators" vs "creators
growing much faster than units" -- but there is no saved creator-count
*history* anywhere in this pipeline to measure creator growth from
(`engine.features.lead_raw` is wired for exactly that, but nothing in
`engine.run` has ever populated `lead_signal`, so it's always 0 -- see
CLAUDE.md's "Not started: Phase 3"). This uses what IS already saved per
product instead: `daily_units_14`'s own trend for "units growing", and
creators-per-100-units-sold-this-week as a static stand-in for how far a
product's creator rush has already gone. 0 FastMoss credits either way --
both inputs are already fetched and exported for every enriched product.
"""

from __future__ import annotations

from collections.abc import Sequence

from engine.features import slope_log1p


def saturation_badge(
    daily_units_14: Sequence[float] | None,
    creator_count: int | None,
    units_7d: float,
    creators_per_100_units_entra_ya_max: float = 2.0,
    creators_per_100_units_muy_lleno_min: float = 6.0,
    units_slope_growing_min: float = 0.02,
) -> dict[str, str] | None:
    """None when there's no trend data to judge this from (no daily series,
    or creator_count was never enriched for this product)."""
    if not daily_units_14 or creator_count is None or units_7d <= 0:
        return None

    slope = slope_log1p(daily_units_14)
    creators_per_100 = creator_count / units_7d * 100

    if creators_per_100 >= creators_per_100_units_muy_lleno_min:
        return {
            "level": "muy_lleno",
            "reason_es": "Ya hay muchas creadoras vendiéndolo frente a lo que realmente se vende.",
            "reason_en": "A lot of creators are already selling it relative to how much it actually sells.",
        }
    if slope <= 0 and creators_per_100 > creators_per_100_units_entra_ya_max:
        return {
            "level": "muy_lleno",
            "reason_es": "Las ventas no están creciendo y ya hay varias creadoras vendiéndolo.",
            "reason_en": "Sales aren't growing and several creators are already selling it.",
        }
    if slope >= units_slope_growing_min and creators_per_100 <= creators_per_100_units_entra_ya_max:
        return {
            "level": "entra_ya",
            "reason_es": "Las ventas están subiendo y todavía hay pocas creadoras vendiéndolo.",
            "reason_en": "Sales are climbing and few creators are selling it yet.",
        }
    return {
        "level": "normal",
        "reason_es": "Nivel normal de competencia -- ni muy lleno ni con mucho espacio todavía.",
        "reason_en": "A normal level of competition -- not crowded, not wide open either.",
    }
