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
