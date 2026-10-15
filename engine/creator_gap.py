"""H5 "Pocas creadoras latinas" badge, part of the 2026-10-15 creator-
workflow upgrade. Reuses `spanish_share` (engine.language.spanish_share),
already computed per candidate for scoring's spanish_gap term -- this just
exposes the same signal as a standalone badge condition instead of only a
"reasons" bullet."""

from __future__ import annotations


def pocas_creadoras_latinas(
    spanish_share: float | None,
    units_7d: float | None,
    spanish_share_max: float = 0.3,
    min_units_7d: float = 100,
) -> bool:
    """True when a product is already selling well (units_7d >= min_units_7d)
    but few of its top videos are in Spanish (spanish_share < spanish_share_max).
    False (never None) when either input is missing -- "no signal" isn't a
    badge state here, just a plain no."""
    if spanish_share is None or units_7d is None:
        return False
    return spanish_share < spanish_share_max and units_7d >= min_units_7d
