# FastMoss credit log

One line per run, appended automatically by `engine/run.py` (spec section 9)
once it completes successfully. `engine/budget.py`'s `BudgetTracker` logs
every call to the `credit_ledger` SQLite table as it happens (so a crash
mid-run still leaves a record there even if this file doesn't get a line) --
see `data/radar.db`'s `credit_ledger` table for the full per-call breakdown.
Rows before Phase 1 existed are manual before/after balance checks instead.

| Date | Run | Credits used | Balance after | Notes |
|---|---|---|---|---|
| 2026-10-14 | Phase 0 discovery | 9 | 491 / 500 | credit_usage_summary, search_category_by_words (0cr), 2x product_rank_top_selling (shapewear, week 2026-W41), product_sales_trend, video_search, creator_search, creator_video_analysis for @roxm___, video_detail_analysis (timezone confirmation). Well under the 15-credit Phase 0 budget. |
| 2026-10-15 | Phase 1 field-check | 3 | 488 / 500 | product_overview for the #1 shapewear product, to confirm its real shape before wiring the ads-share risk rule and momentum's lead term (see docs/field_map.md). Confirmed 3 credits, no buyer demographics present. |
| 2026-10-14 | 2026-W42 ingest (manual, crashed before logging) | 56 | 432 / 500 | First real `python -m engine.run` for 2026-W42: 4 categories x product_rank_top_selling (4cr), 12x product_sales_trend (~2cr each), 6x product_overview (3cr each, confirmed). Completed ingest successfully but then crashed in local scoring (NaN from a `None`-vs-pandas-NaN bug, since fixed) before reaching `append_credit_log` -- recovered via `--resume-week 2026-W42` instead of re-ingesting, see next row. |
| 2026-10-14 | 2026-W42-0e5dac45 (`--resume-week`) | 10 | 422 / 500 | Completed the 2026-W42 run from the already-fetched snapshots above (0 extra credits for rankings/trends/overview) plus 10 fresh video_search calls for the Spanish-gap signal on the preliminary top 10. 9 real picks exported. |
| 2026-10-14 | 2026-W42-c40af481 | 4 | 418 / 500 | Phase 1+2 real run: 3 picks from 35 candidates. spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr |
| 2026-10-14 | 2026-W42-572d9097 | 0 | 418 / 500 | Phase 1+2 real run: 9 picks from 35 candidates.  |
| 2026-10-14 | 2026-W42-3fc74db3 | 0 | 418 / 500 | Phase 1+2 real run: 9 picks from 35 candidates.  |
| 2026-10-14 | 2026-W42-f2f72992 | 0 | 418 / 500 | Phase 1+2 real run: 9 picks from 35 candidates.  |
| 2026-10-14 | 2026-W42-6ed4b79e | 0 | 418 / 500 | Phase 1+2 real run: 9 picks from 35 candidates.  |
| 2026-10-14 | 2026-W42-36359a75 | 0 | 418 / 500 | Phase 1+2 real run: 8 picks from 35 candidates.  |
| 2026-10-14 | field-check-product_video_list | 1 | 417 / 500 | Confirmed `product_video_list`'s real response shape (one call, product_id 1732491682604749463) before wiring it in to replace `video_search`'s keyword search -- see docs/field_map.md. Captions here were all genuinely about the product (video_search's were not). |
| 2026-10-14 | 2026-W42-ee5d5695 | 10 | 407 / 500 | Phase 1+2 real run: 9 picks from 35 candidates. spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr; spanish_gap=1cr |
| 2026-10-14 | 2026-W42-1a43be0b | 0 | 407 / 500 | Phase 1+2 real run: 9 picks from 35 candidates.  |
| 2026-10-14 | 2026-W42-46f63390 | 0 | 407 / 500 | Phase 1+2 real run: 7 picks from 35 candidates.  |
| 2026-10-14 | 2026-W42-05521909 | 70 | 337 / 500 | Phase 1+2 real run: 9 picks from 244 candidates. category_resolution=0cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; rankings=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr; trend=2cr; videos=1cr |
