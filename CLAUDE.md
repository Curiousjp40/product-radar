# Product Radar: notes for Claude

Read `PRODUCT_RADAR_SPEC.md` before doing anything. It is the source of truth for goals, algorithms, data model, budget and build phases.

## Rules
- Work phase by phase (spec section 12). If `FASTMOSS_API_KEY` is not set, do Phase 0a only.
- Never guess FastMoss tool arguments or response fields. Use the saved schemas in `docs/fastmoss_tools.json` and fixtures in `tests/fixtures/`. Missing fields go in `docs/field_map.md`.
- The FastMoss key is read from the environment only (`.env` locally, GitHub secret `FASTMOSS_API_KEY` in CI). Never print it, commit it, or ask for it in chat. Mask it in logs and error messages (it is part of the MCP URL).
- Check the credit balance before any paid call; respect the per-run cap (spec section 9); log every call to the credit ledger.
- Never run `python -m engine.run` in any mode other than `--dry-run`, nor call a FastMoss MCP tool directly, without asking Ryan first and stating the expected credit cost -- `--resume-week` once looked credit-free and silently spent ~45 credits (2026-10-15) because the reuse-from-disk check was wrong. A free, read-only call like `credit_usage_summary` is fine without asking.
- Algorithms are pure functions with unit tests. Weights and thresholds live in `config/*.yaml`.
- UI is Spanish-first with an English toggle, and must work at 390px width.
- Plain-language reasons accompany every score, in Spanish and English.
- Keep `data/seed/creator_history.json` read-only; it is the original history from both creators' FastMoss exports.

## People
- Roxie (@roxm___): primary user, TikTok Shop affiliate creator.
- Ari (@ariannamendoza04): benchmark creator. The repo and site are public (Ryan's decision, 2026-10-15; the FastMoss data is publicly available anyway).
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

Hosting (decided 2026-10-15): public repo + public GitHub Pages site at
https://curiousjp40.github.io/product-radar/ (no login, no Cloudflare).
`.github/workflows/pages.yml` builds `web/` and deploys on pushes to main and
after every "Weekly run". `.github/workflows/weekly-run.yml` (cron Mon 6:15 AM
ET + manual trigger) runs the pipeline, commits data, and sends the Spanish
digest via Gmail SMTP (`engine/digest.py`); the digest step skips itself
until `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `DIGEST_TO` secrets exist.
"Mi lista" (`web/src/pipeline.ts`) saves in each browser's localStorage, so
each device keeps its own list. Data files store images as `/img/...`; the
site resolves them relative to the page (`web/src/asset.ts`) because Pages
serves it from the `/product-radar/` sub-path. Secrets never go in the repo;
Roxie's email exists only as the `DIGEST_TO` secret.

Not started: Phase 3 (weekly learning loop re-fitting composite/momentum
weights from outcome data) and Phase 5/6 per the spec -- there isn't outcome
data yet to learn from.
