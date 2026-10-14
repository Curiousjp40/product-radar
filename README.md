# Product Radar

Weekly, automatic TikTok Shop product picks for Roxie (@roxm___). Every Monday it pulls trending and top-selling products from FastMoss, scores them on how much money they are likely to make for her, and publishes a ranked Top 10 with reasons in Spanish and English. It tracks what she films and learns from the results.

- Full design: [PRODUCT_RADAR_SPEC.md](PRODUCT_RADAR_SPEC.md)
- Notes for Claude: [CLAUDE.md](CLAUDE.md)
- Starter data: `data/seed/creator_history.json` (100 videos from Roxie's and Ari's FastMoss exports)

## Setup
1. Get a FastMoss MCP API key (developers.fastmoss.com, Basic plan).
2. Local: copy `.env.example` to `.env` and put the key there. `.env` is gitignored.
3. GitHub: Settings > Secrets and variables > Actions > New repository secret, name `FASTMOSS_API_KEY`.

## Status
Phase 0a (no key needed) is next. See spec section 12.
