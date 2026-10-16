// Part C1g: the Worker's /credits route proxies FastMoss's free (0-credit)
// credit_usage_summary tool, cached 15 min server-side. Same base URL
// buscarCuenta.ts uses -- see its comment for the setup walkthrough.
import { getStoredPassword, setStoredPassword } from "./searchPassword";

const WORKER_URL = "https://product-radar-search.roxie-radar.workers.dev";

export interface CreditsSummary {
  plan_credits_remaining: number;
  topup_credits_remaining: number;
  plan_expire_at: string;
}

// Privacy fix (2026-10-16): Ryan's FastMoss balance is now password-gated
// (worker/src/index.js's handleCredits) -- never calls the Worker without
// a stored password, so a visitor who hasn't connected just sees nothing
// here rather than triggering a request that would 401 anyway.
export async function fetchCreditsSummary(): Promise<CreditsSummary | null> {
  const password = getStoredPassword();
  if (!WORKER_URL || !password) return null;
  try {
    const resp = await fetch(`${WORKER_URL}/credits`, { headers: { "X-Sync-Password": password } });
    if (resp.status === 401) {
      setStoredPassword(null);
      return null;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    const expireAt = data?.entitlements?.plan_expire_at;
    const buckets: { source_type?: number; remaining_credits?: number }[] = data?.credit_buckets ?? [];
    // source_type 2 = subscription (plan) bucket, 1 = top-up package --
    // *_credits_remaining comes from each bucket's own remaining_credits,
    // not granted_by_source (which is lifetime granted, not what's left).
    const planBucket = buckets.find((b) => b.source_type === 2);
    const topupRemaining = buckets.filter((b) => b.source_type === 1).reduce((sum, b) => sum + (b.remaining_credits ?? 0), 0);
    const plan = planBucket?.remaining_credits;
    // The "credits/week" average used to be computed here from
    // total_consumed_credits / time-since-plan-start -- that produced
    // "~2071 credits/week" right after a one-time backfill inflated
    // total_consumed over a tiny elapsed window. Fixed 2026-10-16: the
    // real per-run average now comes from meta.json's avg_credits_per_run
    // (engine.budget.average_credits_per_run, computed from the local
    // credit_ledger, which this Worker route has no access to).
    if (typeof plan !== "number" || typeof expireAt !== "string") return null;
    return { plan_credits_remaining: plan, topup_credits_remaining: topupRemaining, plan_expire_at: expireAt };
  } catch {
    return null;
  }
}
