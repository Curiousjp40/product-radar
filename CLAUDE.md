# Product Radar: notes for Claude

Read `PRODUCT_RADAR_SPEC.md` before doing anything. It is the source of truth for goals, algorithms, data model, budget and build phases.

## Rules
- Work phase by phase (spec section 12). If `FASTMOSS_API_KEY` is not set, do Phase 0a only.
- Never guess FastMoss tool arguments or response fields. Use the saved schemas in `docs/fastmoss_tools.json` and fixtures in `tests/fixtures/`. Missing fields go in `docs/field_map.md`.
- The FastMoss key is read from the environment only (`.env` locally, GitHub secret `FASTMOSS_API_KEY` in CI). Never print it, commit it, or ask for it in chat. Mask it in logs and error messages (it is part of the MCP URL).
- Check the credit balance before any paid call; respect the per-run cap (spec section 9); log every call to the credit ledger.
- Algorithms are pure functions with unit tests. Weights and thresholds live in `config/*.yaml`.
- UI is Spanish-first with an English toggle, and must work at 390px width.
- Plain-language reasons accompany every score, in Spanish and English.
- Keep `data/seed/creator_history.json` read-only; it is the original history from both creators' FastMoss exports.

## People
- Roxie (@roxm___): primary user, TikTok Shop affiliate creator.
- Ari (@ariannamendoza04): benchmark creator; her data is used with permission and must stay private (dashboard behind login).
- Ryan: repo owner.

## Status (updated 2026-10-14)
Phase 0a done: engine algorithms (pure functions, 114 tests), seed import +
content insights run against the real `data/seed/creator_history.json`,
dashboard shell. Phase 0 done: `docs/fastmoss_tools.json` (55 tools) and
`docs/field_map.md` filled in from real calls, 9 credits used. Notable
Phase 0 findings: FastMoss timestamps are UTC+8 (confirmed, not guessed);
`commission_rate_percent` is a percent-integer not a 0-1 fraction;
`creator_count`/`video_count`/`live_count` live on `product_sales_trend`,
not the ranking endpoint.

A separate session updated section 6.2 (momentum now has a `lead` term) and
6.9 (new ads-share risk rule) after this session had already implemented the
old formulas -- `engine/features.py` (`lead_raw`, `momentum`),
`engine/scoring.py` (`risk_penalty`'s `ads_share_pct`), and
`config/weights.yaml` are now updated to match and re-tested. `normalize.py`
(Phase 1) will still need real calls to `product_creator_analysis`,
`product_video_list` and `product_overview` to confirm the exact field names
those two new inputs come from -- see `docs/field_map.md`'s "Not yet
confirmed" section.

Not started: Phase 1 (ingest.py/normalize.py writing real weekly snapshots
to `data/radar.db`).
