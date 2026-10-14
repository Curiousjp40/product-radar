# Product Radar — conventions

Full spec: [PRODUCT_RADAR_SPEC.md](PRODUCT_RADAR_SPEC.md). Read section 0 and section 12 before doing anything else.

## Where things stand

- **Phase 0a** (no FastMoss key needed): repo tooling, section 6 algorithms as pure functions, seed import + section 8 insights, dashboard shell on synthetic data.
- **Phase 0+** (needs `FASTMOSS_API_KEY` in `.env`): not started. Do not guess FastMoss field/tool names — save real fixtures first (see spec section 0.2 and 12).

## Rules that bite if ignored

- Every section-6 algorithm is a pure function: plain numbers/dicts in, numbers out. No I/O, no globals. The pipeline (`engine/run.py`, not built yet) wires them together.
- Weights and thresholds default to the numbers in `config/weights.yaml` — when `run.py` is built it must load that file, not hardcode numbers. Function signatures take weights as keyword args with defaults that mirror the YAML, so keep the two in sync if you change one.
- `z(x)` = robust z-score, grouped by category+week, `(x - median) / (1.4826 * MAD)`, clipped to [-3, 3]; fall back to ungrouped if a category has fewer than 8 products in that week. Implemented in `engine/stats.py`.
- The FastMoss API key never goes in chat, code, or git. `.env` is gitignored; CI reads it from the `FASTMOSS_API_KEY` secret.
- Never fabricate FastMoss field names. Everything in `engine/models.py` is generic (not FastMoss-shaped) on purpose — Phase 0's `normalize.py` will map real fixture fields onto it, and anything missing gets written to `docs/field_map.md` with the feature degraded gracefully.
- `data/seed/creator_history.json` is real data (Roxie + Ari's actual videos) — do not fabricate it. `tests/fixtures/*.json` are synthetic and clearly separate.
- Dashboard: Spanish-first with an English toggle, mobile-first (390px). Every reason shown to Roxie is generated in both `es` and `en`.

## Stack

Python 3.12+ (engine, pytest, ruff) · Vite + TypeScript (dashboard, no framework) · SQLite (`data/radar.db`) · GitHub Actions (cron) · Cloudflare Pages + D1 (hosting, decided Phase 4).

## Commands

```bash
python -m pytest           # from product-radar/
ruff check .
npm run dev --prefix web   # dashboard, once scaffolded
```
