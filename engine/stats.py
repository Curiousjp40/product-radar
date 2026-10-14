"""Shared math helpers used across engine/*.py (PRODUCT_RADAR_SPEC.md section 6 intro)."""

from __future__ import annotations

import re
from collections.abc import Sequence

import numpy as np
import pandas as pd

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORD_TOKENS = {"a", "the", "de", "la", "el", "para", "con", "y", "and", "for"}

MAD_SCALE = 1.4826
Z_CLIP = 3.0
MIN_GROUP_SIZE = 8


def robust_z(values: Sequence[float], x: float, mad_scale: float = MAD_SCALE, clip: float = Z_CLIP) -> float:
    """z(x) = (x - median) / (mad_scale * MAD), clipped to +/- clip.

    If every value in `values` is identical (MAD == 0), returns 0.0 for all x
    rather than dividing by zero -- there is no spread to measure a z-score against.
    """
    arr = np.asarray(values, dtype=float)
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median)))
    if mad == 0:
        return 0.0
    z = (x - median) / (mad_scale * mad)
    return float(np.clip(z, -clip, clip))


def grouped_robust_z(
    df: pd.DataFrame,
    value_col: str,
    group_col: str,
    min_group_size: int = MIN_GROUP_SIZE,
    mad_scale: float = MAD_SCALE,
    clip: float = Z_CLIP,
) -> pd.Series:
    """Robust z-score of `value_col`, computed within `group_col`.

    Groups smaller than `min_group_size` fall back to a z-score computed across
    the *entire* frame (spec section 6 intro: "fewer than 8 products in a
    category, compute z across all categories instead").
    """
    overall = df[value_col].astype(float)
    overall_median = overall.median()
    overall_mad = (overall - overall_median).abs().median()

    def z_for_group(group: pd.Series) -> pd.Series:
        if len(group) < min_group_size or overall_mad == 0:
            # still compute per-row below using the overall fallback
            pass
        median = group.median()
        mad = (group - median).abs().median()
        if len(group) < min_group_size:
            median, mad = overall_median, overall_mad
        if mad == 0:
            return pd.Series(0.0, index=group.index)
        z = (group - median) / (mad_scale * mad)
        return z.clip(-clip, clip)

    return overall.groupby(df[group_col]).transform(lambda g: z_for_group(g))


def sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def shrink(local_value: float, local_weight: float, pooled_value: float, k: float) -> float:
    """Empirical-Bayes shrinkage: blend a per-group estimate toward a pooled one.

    `local_weight` is usually a count or view total; larger values trust the
    local estimate more, `k` sets how much pooled data it takes to matter.
    """
    if local_weight + k == 0:
        return pooled_value
    return (local_weight * local_value + k * pooled_value) / (local_weight + k)


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def tokenize_title(title: str) -> set[str]:
    """Lowercase word tokens, filtering a tiny stopword list, for title-overlap
    comparisons (near-duplicate picks in section 6.12, "similar product" feedback
    matching in section 6.6)."""
    tokens = _TOKEN_RE.findall(title.lower())
    return {t for t in tokens if t not in _STOPWORD_TOKENS}


def jaccard(a: set[str], b: set[str]) -> float:
    """|intersection| / |union|; 0.0 if both sets are empty."""
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


def rank(values: Sequence[float], descending: bool = True) -> list[int]:
    """1-based rank of each value (1 = best). Ties keep input order (stable sort),
    not averaged -- good enough for the blended rank in section 6.12, which just
    needs a consistent ordinal."""
    order = sorted(range(len(values)), key=lambda i: values[i], reverse=descending)
    ranks = [0] * len(values)
    for position, i in enumerate(order, start=1):
        ranks[i] = position
    return ranks
