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

## Status (updated 2026-10-15)
Phase 0a, Phase 0, Phase 1, and Phase 2 done. Real weekly ingest + scoring
for 2026-W42 completed, including a suspicious-listing filter
(`engine/quality.py`), lifecycle-stage fix (no more defaulting to
"evergreen"), per-event pick caps keyed by title (a Halloween costume is
category-tagged "womens_clothing" by FastMoss, not "seasonal" -- see
`engine/seasonality.py`'s `title_matches_event_keywords`), and a
`creator_avg_category_gpm` floor so the category_fit reason never cites a
below-average number as a selling point (`engine/fit.py`). 192 tests passing.

Phase 4 code is built but NOT deployed yet: `.github/workflows/weekly-run.yml`
(cron Mon 6:15 AM ET + manual trigger, runs the real pipeline, commits data,
sends the digest), `engine/digest.py` (Spanish HTML/plain-text email via
Gmail SMTP), and `web/functions/api/status.ts` + `web/migrations/0001_*.sql`
(Cloudflare Pages Function + D1 schema for shared shortlist/feedback status,
replacing the Phase 0a localStorage version in `web/src/pipeline.ts`). What's
still manual, one-time, in the Cloudflare/GitHub dashboards: creating the
Cloudflare account, D1 database, Pages project (connected to this repo, root
directory `web`), Access policy (restricted to Ryan's and Roxie's emails),
and the GitHub Actions secrets (`FASTMOSS_API_KEY`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, `DIGEST_TO`, `DASHBOARD_URL`). Not committed: Roxie's
email address -- it only ever needs to exist as the `DIGEST_TO` GitHub
secret, never in a tracked file.

Not started: Phase 3 (weekly learning loop re-fitting composite/momentum
weights from outcome data) and Phase 5/6 per the spec -- there isn't outcome
data yet to learn from.
