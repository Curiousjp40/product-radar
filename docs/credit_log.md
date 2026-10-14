# FastMoss credit log

One line per run, appended by the pipeline (spec section 9). The weekly
pipeline's own ledger logging (credit_ledger table, per-call) isn't built yet
(Phase 1+) -- the Phase 0 row below is a manual before/after balance check,
not a per-call breakdown.

| Date | Run | Credits used | Balance after | Notes |
|---|---|---|---|---|
| 2026-10-14 | Phase 0 discovery | 9 | 491 / 500 | credit_usage_summary, search_category_by_words (0cr), 2x product_rank_top_selling (shapewear, week 2026-W41), product_sales_trend, video_search, creator_search, creator_video_analysis for @roxm___, video_detail_analysis (timezone confirmation). Well under the 15-credit Phase 0 budget. |
| 2026-10-15 | Phase 1 field-check | 3 | 488 / 500 | product_overview for the #1 shapewear product, to confirm its real shape before wiring the ads-share risk rule and momentum's lead term (see docs/field_map.md). Confirmed 3 credits, no buyer demographics present. |
