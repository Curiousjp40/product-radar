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

/**
 * Search-count limits, tightened until the Nov 15 credit reset (added
 * 2026-10-15, same day as the ~45-credit mistake that prompted the other
 * safeguards): only 2 searches/month until the balance resets, then back
 * to the normal 3/day + 15/month. The per-run credit-floor guard
 * (creditGuardOk) stays on regardless of which phase this is -- this limit
 * is an extra, simpler cap on top of it, not a replacement for it.
 */
export function searchLimitsFor(now, resetDate) {
  if (now < resetDate) {
    return { daily: 3, monthly: 2 };
  }
  return { daily: 3, monthly: 15 };
}

/**
 * Whether an outcome should burn one of the daily/monthly search slots
 * (added 2026-10-15, real case: a typo'd handle "roxm__" came back
 * not_found but still spent 1 real credit on creator_search alone -- the
 * credit-floor guard already protects the overall budget regardless, so
 * this is purely about not making a dead-end search cost her one of her
 * precious 2-3 monthly lookups). A cache hit never reaches this at all
 * (handleSearch returns before any counting decision); only "found" counts.
 */
export function countsAgainstQuota(outcome) {
  return outcome === "found";
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

// Hosts the /img proxy will fetch on the caller's behalf (added 2026-10-15:
// s.500fd.com, FastMoss's own CDN, blocks hotlinking from other origins,
// per Ryan's report -- a server-side Worker fetch isn't subject to that).
// TikTok's CDN hostnames vary by region/pop (p16-sign-va.tiktokcdn.com,
// p77-sign-va.tiktokcdn-us.com, etc.), so those are matched by suffix
// rather than an exhaustive exact list. Never a general-purpose proxy: any
// other host is refused.
const ALLOWED_IMAGE_HOST_SUFFIXES = [".tiktokcdn.com", ".tiktokcdn-us.com", ".tiktokcdn-eu.com", ".ibyteimg.com"];

export function isAllowedImageHost(hostname) {
  if (hostname === "s.500fd.com") return true;
  return ALLOWED_IMAGE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
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
 * A real @roxm___ search (2026-10-15) confirmed units_sold/gmv/
 * commission_rate_percent all come through as plain top-level fields, but
 * `price`/`image_url` did not -- creator_product_list's exact response
 * shape still isn't confirmed by a raw fixture (capturing one costs a real
 * call; see worker/test/fixtures/cached_search_result_roxm___.json's note).
 * These two fall back through the field names confirmed on the sibling
 * product_rank_top_selling tool (docs/field_map.md, engine/normalize.py's
 * normalize_rank_row): `floor_price`/`ceiling_price` for price,
 * `cover_url` for the image, each tried flat and nested under a `product`
 * or `shop` sub-object in case creator_product_list groups fields the way
 * creator_video_analysis's `linked_products` does. Still a best-effort
 * inference, not a confirmed mapping -- renderPrice (web/src/views/
 * buscarCuenta.ts) must degrade gracefully either way.
 */
function firstDefined(...values) {
  return values.find((v) => v !== undefined && v !== null);
}

export function mapProductListResult(raw) {
  const list = raw?.list || raw?.products || [];
  return list.slice(0, 10).map((p) => {
    const product = p.product || p;
    const shop = p.shop || {};
    const price = firstDefined(p.price, p.floor_price, product.floor_price, p.price_range);
    const priceMax = firstDefined(p.ceiling_price, product.ceiling_price);
    return {
      product_id: p.product_id ?? product.product_id,
      title: p.title ?? product.title,
      image_url: firstDefined(p.image_url, p.cover_url, product.cover_url, shop.cover_url) ?? null,
      price: price !== undefined && priceMax !== undefined && priceMax !== price ? `${price}-${priceMax}` : price,
      units_sold: p.units_sold ?? p.sold_count,
      gmv: p.gmv,
      commission_rate_percent: p.commission_rate_percent,
    };
  });
}

/**
 * creator_fans_distribution (2cr, docs/fastmoss_tools.json) -- "Returns age,
 * gender, location, and top segments," no output schema or real fixture
 * captured yet. Tries several plausible field names/shapes for the location
 * breakdown (country vs region, nested under `location` or flat), the same
 * tolerant-fallback approach as mapProductListResult, since the real shape
 * is still unconfirmed until a live call captures one. Age/gender here are
 * ignored -- creator_search's audience_summary already covers those for
 * free, so this tool is only worth its 2cr for the location data it alone
 * provides.
 */
export function mapFansDistributionResult(raw) {
  const countries = firstDefined(
    raw?.country_distribution,
    raw?.location_distribution,
    raw?.location?.country_distribution,
    []
  );
  const regions = firstDefined(
    raw?.region_distribution,
    raw?.state_distribution,
    raw?.location?.region_distribution,
    []
  );
  const normalize = (entries) =>
    (entries || [])
      .map((e) => ({
        name: firstDefined(e.country, e.region, e.state, e.name, e.label),
        percentage: firstDefined(e.percentage, e.percent, e.pct),
      }))
      .filter((e) => e.name !== undefined && e.percentage !== undefined);
  return {
    country_distribution: normalize(countries),
    region_distribution: normalize(regions),
  };
}
