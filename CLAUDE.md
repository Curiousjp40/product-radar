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

## Status (updated 2026-10-16)
Phase 0a, Phase 0, Phase 1, and Phase 2 done. Real weekly ingest + scoring
for 2026-W42 completed, including a suspicious-listing filter
(`engine/quality.py`), lifecycle-stage fix (no more defaulting to
"evergreen"), per-event pick caps keyed by title (a Halloween costume is
category-tagged "womens_clothing" by FastMoss, not "seasonal" -- see
`engine/seasonality.py`'s `title_matches_event_keywords`), and a
`creator_avg_category_gpm` floor so the category_fit reason never cites a
below-average number as a selling point (`engine/fit.py`). 327 tests passing.

Hosting (decided 2026-10-15): public repo + public GitHub Pages site at
https://curiousjp40.github.io/product-radar/ (no login, no Cloudflare).
`.github/workflows/pages.yml` builds `web/` and deploys on pushes to main and
after every "Weekly run". `.github/workflows/weekly-run.yml` (two DST-safe
crons, both ~6:15 AM ET year-round + manual trigger) runs the pipeline,
commits data, and sends the Spanish digest via Gmail SMTP (`engine/digest.py`);
the digest step skips itself until `GMAIL_USER`, `GMAIL_APP_PASSWORD` and
`DIGEST_TO` secrets exist. Data files store images as `/img/...`; the
site resolves them relative to the page (`web/src/asset.ts`) because Pages
serves it from the `/product-radar/` sub-path. Secrets never go in the repo;
Roxie's email exists only as the `DIGEST_TO` secret.

Credits: Ryan bought a 2,000-credit never-expiring top-up on 2026-10-16 on
top of the 500/month plan (balance ~2043 as of this writing). Dynamic weekly
budget now uses one flat 300-credit safety floor (`config/weights.yaml`
`credits.safety_floor_credits`), not itemized reserves. Worker search limits
are 5/day + 40/month (`worker/src/logic.js`).

Cloudflare Worker (`worker/`, deployed): account search (`/`, password-gated
POST), image proxy (`/img`), free credit balance (`/credits`), and a generic
synced-storage route (`/state?key=<name>`, GET free / POST password-gated) used
by Mis Productos and ready for Mi lista/No me interesa later. `SEARCH_KV`
namespace holds cached searches, daily/monthly counters, and `state:<key>`
blobs.

### In progress -- Ryan's 8-part "Next round of features" request (2026-10-15/16)
Done and pushed: 1 (video/hashtag backfill -- 244/250 products have videos;
best-time-to-post engine `engine/posting_time.py` + UI), 2 (dead-link fix via
the no-videos fallback), 3 (more items on Hoy/Esta semana/Todos, suspicious
hidden not dimmed), 4 (No me interesa + Ocultos + category-hide offer), 5
(Mis Productos page, replaces Muestras as the main tab, synced via Worker
`/state`), 6a (diagnosed the account-search failure), 6b (saved searches +
Comparar cuentas, Worker `/saved` route), 7a (video best-time), 7b (live
best-time -- `engine/live_backfill.py`, run monthly, 15cr/run), 7c (Mejores
Horas page).

**Still pending:**
- **6c** was covered by 6b's compare view (follow-up tasks were merged --
  see the 6b commit for exactly what it compares and what it can't: no
  live/hashtag-per-account data exists yet).
- **8**: expose the earnings Roxie logs in Mis Productos to the weekly run
  (read from Worker KV via a new GitHub secret) and store in `data/radar.db`
  -- just collecting outcome data, no re-fitting of weights yet. Not started
  -- in progress now.
- Phase 3 (weekly learning loop re-fitting composite/momentum weights from
  outcome data) still can't start until part 8 gives it something to learn
  from. Phase 5/6 per the spec also not started.
