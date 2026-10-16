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
All 8 parts of the 2026-10-15/16 "Next round of features" request are done
and pushed: 1 (video/hashtag backfill -- 244/250 products have videos;
best-time-to-post engine `engine/posting_time.py` + UI), 2 (dead-link fix via
the no-videos fallback), 3 (more items on Hoy/Esta semana/Todos, suspicious
hidden not dimmed), 4 (No me interesa + Ocultos + category-hide offer), 5
(Mis Productos page, replaces Muestras as the main tab, synced via Worker
`/state`), 6a (diagnosed the account-search failure), 6b/6c (saved searches +
Comparar cuentas, Worker `/saved` route -- see that commit for exactly what
the compare view shows and what it can't: no live/hashtag-per-account data
exists), 7a (video best-time), 7b (live best-time -- `engine/live_backfill.py`,
run monthly, ~15cr/run), 7c (Mejores Horas page), 8 (Mis Productos earnings ->
`data/radar.db`'s new `mis_productos_earnings` table, via the Worker's new
token-gated `/admin/mis-productos` route).

`MIS_PRODUCTOS_TOKEN` is set and confirmed working end-to-end (2026-10-16):
dispatched `.github/workflows/test-mis-productos-secret.yml` (manual-trigger,
read-only, 0 FastMoss credits) against the real secret -- `OK: fetched 0 Mis
Productos item(s)` (0 is expected, nothing's been added to Mis Productos
yet). Along the way, found and fixed a real bug: Cloudflare's bot-fight
check 403's the default Python `urllib` User-Agent before it even reaches
the Worker -- `engine/earnings.py` now sends a browser-looking UA.

### 2026-10-16 follow-up requests (all done and pushed)
- Weekly picks raised ~10 -> 20 (`config/weights.yaml`'s `picks:` section;
  18 actual this week, evergreen had no eligible candidate). Hoy shows 1
  hero + up to 8 "also good" plus a "Ver los N de la semana" link.
- Earnings-goal upgrade (0 credits, synced via the Worker's `/state`
  route): quick "+Venta", pace/projection, "lo que te falta", a weekly
  video mini-goal, milestone celebrations + a "Logros" badge row, day/week
  streaks, and a new **Mi Dinero** page (Mas) -- monthly chart, by
  category/product, $/hour of filming, free-sample value, pending-vs-paid,
  goal history. See that commit for the real timezone bug it caught and
  fixed (`parseLocalDate` in `earningsGoalLogic.ts`).
- Thursday "midweek refresh" built (`engine/midweek_refresh.py`,
  `.github/workflows/midweek-refresh.yml`) -- re-pulls only top-selling
  rankings, flags 10+ place rank jumps as "Subiendo rapido"/"Rising fast",
  fetches a video for brand-new top-10 entries. **Schedule intentionally
  left disabled** (the `schedule:` trigger is commented out in the
  workflow) pending Ryan's go-ahead on the confirmed cost: a real dry-run
  dispatch in CI reported 25 credits (10 active categories today) +
  a small variable amount for brand-new top-10 entries' videos. Uncomment
  the two `cron:` lines to turn it on.

**Not started:** Phase 3 (weekly learning loop re-fitting composite/momentum
weights from outcome data) -- part 8 only just started collecting that data,
there isn't enough of it yet to fit anything against. Phase 5/6 per the spec
also not started.
