// Part C1g: the Worker's /credits route proxies FastMoss's free (0-credit)
// credit_usage_summary tool, cached 15 min server-side. Same base URL
// buscarCuenta.ts uses -- see its comment for the setup walkthrough.
const WORKER_URL = "https://product-radar-search.roxie-radar.workers.dev";

export interface CreditsSummary {
  plan_credits_remaining: number;
  topup_credits_remaining: number;
  plan_expire_at: string;
  avg_credits_per_week: number | null;
}

function weeksSince(isoLike: string): number | null {
  const start = new Date(isoLike.replace(" ", "T"));
  if (Number.isNaN(start.getTime())) return null;
  const days = (Date.now() - start.getTime()) / 86_400_000;
  return days > 0 ? days / 7 : null;
}

export async function fetchCreditsSummary(): Promise<CreditsSummary | null> {
  if (!WORKER_URL) return null;
  try {
    const resp = await fetch(`${WORKER_URL}/credits`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const expireAt = data?.entitlements?.plan_expire_at;
    const totalConsumed = data?.balance?.total_consumed_credits;
    const buckets: { source_type?: number; remaining_credits?: number; effective_at?: string }[] = data?.credit_buckets ?? [];
    // source_type 2 = subscription (plan) bucket, 1 = top-up package --
    // *_credits_remaining comes from each bucket's own remaining_credits,
    // not granted_by_source (which is lifetime granted, not what's left).
    const planBucket = buckets.find((b) => b.source_type === 2);
    const topupRemaining = buckets.filter((b) => b.source_type === 1).reduce((sum, b) => sum + (b.remaining_credits ?? 0), 0);
    const plan = planBucket?.remaining_credits;
    // The plan bucket's effective_at is when this plan period started --
    // used as a rough "credits used per week so far" since the Worker
    // only proxies the free summary, not the local credit ledger
    // (data/radar.db); this is the best free approximation available.
    const weeks = typeof planBucket?.effective_at === "string" ? weeksSince(planBucket.effective_at) : null;
    const avgPerWeek = weeks && typeof totalConsumed === "number" ? Math.round(totalConsumed / weeks) : null;
    if (typeof plan !== "number" || typeof expireAt !== "string") return null;
    return { plan_credits_remaining: plan, topup_credits_remaining: topupRemaining, plan_expire_at: expireAt, avg_credits_per_week: avgPerWeek };
  } catch {
    return null;
  }
}
