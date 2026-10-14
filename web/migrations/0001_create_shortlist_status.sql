-- Phase 4 (spec section 10.4): shared shortlist/feedback status per product,
-- read and written by web/functions/api/status.ts. Replaces the Phase 0a
-- localStorage version (web/src/pipeline.ts) so Roxie's status is shared
-- across devices and visible to Ryan too, instead of living in one browser.
--
-- Apply with:
--   npx wrangler d1 execute product-radar --remote --file=migrations/0001_create_shortlist_status.sql
-- (drop --remote to apply to the local dev D1 instance instead)

CREATE TABLE IF NOT EXISTS shortlist_status (
    product_id TEXT PRIMARY KEY,
    status TEXT,       -- PipelineStatusName (web/src/types.ts), e.g. "shortlisted", "filmed", "posted"
    feedback TEXT,      -- "not_for_me" | "love_it"
    updated_at TEXT NOT NULL,
    updated_by TEXT     -- email from the Cf-Access-Authenticated-User-Email header, or "unknown"
);
