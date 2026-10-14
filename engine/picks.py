"""Top-10 assembly, diversity, explore/exploit, and bilingual reasons -- spec
sections 6.12 and 6.13.

Candidate dicts throughout this module are expected to have at least:
`product_id`, `category`, `shop_id`, `title`.
"""

from __future__ import annotations

import random
from typing import Literal

from engine.stats import jaccard, rank, tokenize_title


def blended_rank(score_rank: int, ev_rank: int, score_weight: float = 0.5, ev_weight: float = 0.5) -> float:
    """section 6.12 step 2."""
    return score_weight * score_rank + ev_weight * ev_rank


def compute_blended_ranks(candidates: list[dict]) -> list[dict]:
    """Adds `score_rank`, `ev_rank`, `blended_rank` to each candidate dict
    (expects `score` and `ev_typical` keys). Returns a new list, best first."""
    scores = [c["score"] for c in candidates]
    evs = [c["ev_typical"] for c in candidates]
    score_ranks = rank(scores, descending=True)
    ev_ranks = rank(evs, descending=True)
    enriched = []
    for c, sr, er in zip(candidates, score_ranks, ev_ranks, strict=True):
        enriched.append({**c, "score_rank": sr, "ev_rank": er, "blended_rank": blended_rank(sr, er)})
    return sorted(enriched, key=lambda c: c["blended_rank"])


def is_near_duplicate(title_a: str, title_b: str, threshold: float = 0.6) -> bool:
    return jaccard(tokenize_title(title_a), tokenize_title(title_b)) > threshold


def candidate_event_ids(cand: dict) -> list[str]:
    """Which event ids a candidate counts against for `event_caps` purposes:
    its `capped_event_ids` (title-keyword matches, see engine/run.py's
    score_pool) if present, else falling back to `[matched_event_id]`."""
    event_ids = cand.get("capped_event_ids")
    if event_ids:
        return event_ids
    matched = cand.get("matched_event_id")
    return [matched] if matched is not None else []


def filter_diverse_topn(
    ranked_candidates: list[dict],
    n: int,
    max_per_category: int = 3,
    max_per_shop: int = 2,
    title_jaccard_threshold: float = 0.6,
    event_caps: dict[str, int] | None = None,
) -> list[dict]:
    """Greedy pick from `ranked_candidates` (best first), enforcing section
    6.12 step 3's diversity caps and near-duplicate exclusion.

    `event_caps` (added 2026-10-15, e.g. "max 1 Halloween pick"): maps an
    event id to how many selected candidates may count against it. This is
    PER-EVENT, not global, on purpose: an event with no entry in `event_caps`
    (e.g. a broad scoring boost like Black Friday, which matches most
    categories) is never capped -- a single global cap here previously
    collapsed the whole picks list to 1 once Black Friday's 21-day lookahead
    window opened and started matching nearly every candidate as its best
    event. A candidate counts against an event via its `capped_event_ids`
    list if present (set by the scoring pipeline from title-keyword matches,
    since e.g. a real Halloween costume is category-tagged "womens_clothing",
    not "seasonal", and Black Friday's boost usually outscores Halloween's
    for `matched_event_id` once Halloween's own window is closing); falling
    back to `[matched_event_id]` when a candidate has no `capped_event_ids`."""
    selected: list[dict] = []
    category_counts: dict[str, int] = {}
    shop_counts: dict[str, int] = {}
    event_counts: dict[str, int] = {}
    event_caps = event_caps or {}
    for cand in ranked_candidates:
        if len(selected) >= n:
            break
        category = cand["category"]
        shop_id = cand["shop_id"]
        event_ids = candidate_event_ids(cand)
        if category_counts.get(category, 0) >= max_per_category:
            continue
        if shop_counts.get(shop_id, 0) >= max_per_shop:
            continue
        if any(event_caps.get(eid) is not None and event_counts.get(eid, 0) >= event_caps[eid] for eid in event_ids):
            continue
        if any(is_near_duplicate(cand["title"], s["title"], title_jaccard_threshold) for s in selected):
            continue
        selected.append(cand)
        category_counts[category] = category_counts.get(category, 0) + 1
        shop_counts[shop_id] = shop_counts.get(shop_id, 0) + 1
        for eid in event_ids:
            if eid in event_caps:
                event_counts[eid] = event_counts.get(eid, 0) + 1
    return selected


def exclude_recent_films(
    candidates: list[dict],
    recently_filmed_product_ids: set[str],
    winner_again_product_ids: set[str] = frozenset(),
) -> list[dict]:
    """section 6.12 step 5: drop anything filmed in the last 30 days, unless
    it's a past winner that's trending again."""
    return [
        c
        for c in candidates
        if c["product_id"] not in recently_filmed_product_ids or c["product_id"] in winner_again_product_ids
    ]


def thompson_sample_categories(
    beliefs: dict[str, tuple[float, float]], rng: random.Random | None = None
) -> dict[str, float]:
    """One Beta(alpha, beta) draw per category, section 6.13."""
    rng = rng or random.Random()
    return {category: rng.betavariate(alpha, beta) for category, (alpha, beta) in beliefs.items()}


def pick_explore_categories(
    sampled: dict[str, float],
    trial_counts: dict[str, int],
    k: int = 2,
    min_trials_considered_tested: int = 5,
) -> list[str]:
    """Top-k sampled categories among the under-tested ones first (section
    6.13); if fewer than k categories are under-tested, fills the rest from the
    best of the remaining (tested) categories -- the spec doesn't say what to
    do if every category is already well-tested, and "no explore slot filled
    at all" would waste the budget it's meant to spend."""
    under_tested = sorted(
        (c for c in sampled if trial_counts.get(c, 0) < min_trials_considered_tested),
        key=lambda c: sampled[c],
        reverse=True,
    )
    chosen = under_tested[:k]
    if len(chosen) < k:
        remaining = sorted(
            (c for c in sampled if c not in chosen),
            key=lambda c: sampled[c],
            reverse=True,
        )
        chosen += remaining[: k - len(chosen)]
    return chosen


def build_top10(
    ranked_diverse_candidates: list[dict],
    explore_candidates: list[dict],
    evergreen_candidate: dict | None,
    evergreen_kind: Literal["evergreen", "winner_again"] = "evergreen",
    core_slots: int = 7,
    explore_slots: int = 2,
    evergreen_slots: int = 1,
) -> list[dict]:
    """Assemble the final picks list with `kind` and `slot`, section 6.12 step 4.
    Each input list/candidate should already be deduplicated/filtered by the
    other functions in this module. Candidates are SELECTED in priority order
    (evergreen/winner-again, then explore, then core -- the rarer/most
    specific slots claim a product first, so dedup across buckets favors
    them), but DISPLAYED in a different order (added 2026-10-15, after the
    dashboard showed explore picks mixed in ahead of stronger core picks):
    core first (already blended-rank order from `ranked_diverse_candidates`),
    then explore, then evergreen/winner-again last."""
    picks: list[dict] = []
    used_ids: set[str] = set()

    def add(cand: dict | None, kind: str) -> None:
        if cand is None or cand["product_id"] in used_ids:
            return
        used_ids.add(cand["product_id"])
        picks.append({**cand, "kind": kind})

    if evergreen_slots > 0:
        add(evergreen_candidate, evergreen_kind)

    explore_added = 0
    for cand in explore_candidates:
        if explore_added >= explore_slots:
            break
        before = len(picks)
        add(cand, "explore")
        if len(picks) > before:
            explore_added += 1

    core_added = 0
    for cand in ranked_diverse_candidates:
        if core_added >= core_slots:
            break
        before = len(picks)
        add(cand, "core")
        if len(picks) > before:
            core_added += 1

    display_order = {"core": 0, "explore": 1, "evergreen": 2, "winner_again": 2}
    picks.sort(key=lambda p: display_order.get(p["kind"], 3))

    for i, p in enumerate(picks, start=1):
        p["slot"] = i
    return picks


_REASON_TEMPLATES = {
    ("momentum", "es"): "Ventas subiendo {pct:.0f}% esta semana",
    ("momentum", "en"): "Sales up {pct:.0f}% this week",
    ("earnings", "es"): "Pagas ~${amount:.2f} por venta",
    ("earnings", "en"): "You earn ~${amount:.2f} per sale",
    ("spanish_gap", "es"): "Pocas creadoras en espanol ({n} de {total} videos)",
    ("spanish_gap", "en"): "Few Spanish-speaking creators ({n} of {total} videos)",
    ("seasonality", "es"): "Temporada: {event} en {days} dias",
    ("seasonality", "en"): "Season: {event} in {days} days",
    ("fit", "es"): "Esta categoria te funciona bien",
    ("fit", "en"): "This category works well for you",
    # Added 2026-10-15: the generic "fit" reason above never cited a number --
    # this cites her own actual category_gpm (GMV per 1,000 views), real data.
    ("category_fit", "es"): "{category_label}: ${gpm:.2f} por cada 1,000 vistas para ti",
    ("category_fit", "en"): "{category_label}: ${gpm:.2f} per 1,000 views for you",
}


def select_top_reasons(component_magnitudes: dict[str, float], max_reasons: int = 3) -> list[str]:
    """Which 2-3 components to render as reasons, section 6.12 step 6: the
    largest-magnitude components win, positive or negative."""
    return [k for k, _ in sorted(component_magnitudes.items(), key=lambda kv: abs(kv[1]), reverse=True)[:max_reasons]]


def render_reason(component: str, lang: Literal["es", "en"], **kwargs: object) -> str:
    key = (component, lang)
    if key not in _REASON_TEMPLATES:
        raise KeyError(f"no reason template for component={component!r} lang={lang!r}")
    return _REASON_TEMPLATES[key].format(**kwargs)
