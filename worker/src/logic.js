/**
 * Pure helpers for the Buscar cuenta Worker -- no fetch, no KV, no Date.now()
 * defaults, so they're plain-testable with node:test (see test/logic.test.js).
 */

export function normalizeHandle(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^@/, "").toLowerCase();
  if (!trimmed || !/^[a-z0-9._]{1,24}$/.test(trimmed)) return null;
  return trimmed;
}

export function cacheKeyFor(handle) {
  return `cache:${handle}`;
}

export function dailyCountKey(date) {
  return `count:daily:${date.toISOString().slice(0, 10)}`;
}

export function monthlyCountKey(date) {
  return `count:monthly:${date.toISOString().slice(0, 7)}`;
}

/**
 * How many Mondays remain, starting today (inclusive, if today is a Monday
 * and before resetDate) through resetDate (exclusive) -- the weekly runs
 * still owed credits before the subscription resets. Monday = getUTCDay()
 * 1.
 */
export function mondaysRemaining(today, resetDate) {
  let count = 0;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  while (d < resetDate) {
    if (d.getUTCDay() === 1) count += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/**
 * Refuses a search if spending `costCredits` would drop the balance below
 * `perRunFloor` x the weekly runs still owed before the credit reset --
 * the weekly pipeline must always be covered first. Returns {ok, floor}.
 */
export function creditGuardOk(balanceAfterSpend, perRunFloor, mondaysLeft) {
  const floor = perRunFloor * mondaysLeft;
  return { ok: balanceAfterSpend >= floor, floor };
}

export function mapCreatorSearchResult(raw) {
  const row = raw?.list?.[0];
  if (!row) return null;
  const creator = row.creator || {};
  const commerce = row.commerce_summary || {};
  const audience = row.audience_summary || {};
  return {
    uid: creator.uid,
    unique_id: creator.unique_id,
    nickname: creator.nickname,
    avatar: creator.avatar,
    follower_count: creator.follower_count,
    video_count_total: creator.video_count_total,
    day28_gmv: commerce.day28_gmv,
    day28_units_sold: commerce.day28_units_sold,
    day28_video_count: commerce.day28_video_count,
    total_gmv: commerce.total_gmv,
    video_avg_play_count: commerce.video_avg_play_count,
    engagement_rate_percent: commerce.engagement_rate_percent,
    trend_categories: commerce.trend_categories || [],
    age_distribution: audience.age_distribution || [],
    gender_distribution: audience.gender_distribution || [],
  };
}

export function mapVideoAnalysisResult(raw) {
  const list = raw?.video_list?.list || [];
  return list.slice(0, 10).map((v) => ({
    video_id: v.video_id,
    caption_text: v.caption_text || "",
    play_count: v.play_count || 0,
    video_units_sold: v.video_units_sold || 0,
    video_gmv: v.video_gmv || 0,
    tiktok_url:
      v.video_id && v.creator_handle ? `https://www.tiktok.com/@${v.creator_handle}/video/${v.video_id}` : null,
  }));
}

/**
 * creator_product_list's response shape isn't confirmed by a real fixture
 * yet (see PRODUCT_RADAR_SPEC follow-up: capture the first real response as
 * tests/fixtures/fastmoss_creator_product_list_*.json and tighten this).
 * Defensive `?.`/fallbacks only -- never invents a field that isn't there.
 */
export function mapProductListResult(raw) {
  const list = raw?.list || raw?.products || [];
  return list.slice(0, 10).map((p) => ({
    product_id: p.product_id,
    title: p.title,
    image_url: p.image_url || p.cover_url || null,
    price: p.price,
    units_sold: p.units_sold ?? p.sold_count,
    gmv: p.gmv,
    commission_rate_percent: p.commission_rate_percent,
  }));
}
