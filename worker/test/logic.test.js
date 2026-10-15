import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cacheKeyFor,
  creditGuardOk,
  dailyCountKey,
  isAllowedImageHost,
  mapCreatorSearchResult,
  mapFansDistributionResult,
  mapProductListResult,
  mapVideoAnalysisResult,
  mondaysRemaining,
  monthlyCountKey,
  normalizeHandle,
  searchLimitsFor,
} from "../src/logic.js";

test("normalizeHandle strips leading @ and lowercases", () => {
  assert.equal(normalizeHandle("@Roxm___"), "roxm___");
  assert.equal(normalizeHandle("  roxm___  "), "roxm___");
});

test("normalizeHandle rejects empty or invalid input", () => {
  assert.equal(normalizeHandle(""), null);
  assert.equal(normalizeHandle("@"), null);
  assert.equal(normalizeHandle("not a handle!"), null);
  assert.equal(normalizeHandle(null), null);
});

test("cacheKeyFor and count keys are stable and namespaced", () => {
  assert.equal(cacheKeyFor("roxm___"), "cache:roxm___");
  assert.equal(dailyCountKey(new Date("2026-10-15T12:00:00Z")), "count:daily:2026-10-15");
  assert.equal(monthlyCountKey(new Date("2026-10-15T12:00:00Z")), "count:monthly:2026-10");
});

test("mondaysRemaining counts the real 2026-10-15 -> 2026-11-15 case", () => {
  // Thursday 2026-10-15 -> Sunday 2026-11-15 reset: Mondays on the 19th,
  // 26th, Nov 2nd and Nov 9th = 4 runs still owed credits.
  const today = new Date("2026-10-15T00:00:00Z");
  const reset = new Date("2026-11-15T00:00:00Z");
  assert.equal(mondaysRemaining(today, reset), 4);
});

test("mondaysRemaining counts today itself when today is a Monday", () => {
  const monday = new Date("2026-10-19T00:00:00Z");
  const nextMonday = new Date("2026-10-26T00:00:00Z");
  assert.equal(mondaysRemaining(monday, nextMonday), 1);
});

test("mondaysRemaining is zero once the reset date has passed", () => {
  const afterReset = new Date("2026-11-20T00:00:00Z");
  const reset = new Date("2026-11-15T00:00:00Z");
  assert.equal(mondaysRemaining(afterReset, reset), 0);
});

test("searchLimitsFor is tightened to 2/month before the reset", () => {
  const beforeReset = new Date("2026-10-20T00:00:00Z");
  const reset = new Date("2026-11-15T00:00:00Z");
  assert.deepEqual(searchLimitsFor(beforeReset, reset), { daily: 3, monthly: 2 });
});

test("searchLimitsFor goes back to 3/day + 15/month after the reset", () => {
  const afterReset = new Date("2026-11-16T00:00:00Z");
  const reset = new Date("2026-11-15T00:00:00Z");
  assert.deepEqual(searchLimitsFor(afterReset, reset), { daily: 3, monthly: 15 });
});

test("creditGuardOk refuses a search that would dip below the weekly floor", () => {
  // real numbers: 292 balance, search costs 3, 4 Mondays left needing 70 each (280).
  const { ok, floor } = creditGuardOk(292 - 3, 70, 4);
  assert.equal(floor, 280);
  assert.equal(ok, true); // 289 >= 280
});

test("creditGuardOk refuses when the floor would be breached", () => {
  const { ok } = creditGuardOk(10, 70, 4); // 10 < 280
  assert.equal(ok, false);
});

test("mapCreatorSearchResult extracts the real roxm___ fixture shape", () => {
  const raw = {
    total: 1,
    list: [
      {
        creator: { uid: "7142953711915025413", unique_id: "roxm___", nickname: "Roxielys", follower_count: 5638, video_count_total: 1121, avatar: "https://x" },
        commerce_summary: { day28_gmv: 2188.35, day28_units_sold: 65, day28_video_count: 116, total_gmv: 45503.11, video_avg_play_count: 3278, engagement_rate_percent: 1.3, trend_categories: [{ id: 1003, name: "Fashion" }] },
        audience_summary: { age_distribution: [{ age_range: "25-34", percentage: 37.15 }], gender_distribution: [{ gender: "female", percentage: 31.27 }] },
      },
    ],
  };
  const creator = mapCreatorSearchResult(raw);
  assert.equal(creator.uid, "7142953711915025413");
  assert.equal(creator.unique_id, "roxm___");
  assert.equal(creator.day28_gmv, 2188.35);
  assert.equal(creator.trend_categories[0].name, "Fashion");
});

test("mapCreatorSearchResult returns null when nothing was found", () => {
  assert.equal(mapCreatorSearchResult({ total: 0, list: [] }), null);
  assert.equal(mapCreatorSearchResult({}), null);
});

test("mapVideoAnalysisResult extracts the real roxm___ fixture shape, capped at 10", () => {
  const raw = {
    video_list: {
      list: Array.from({ length: 15 }, (_, i) => ({
        video_id: `v${i}`,
        caption_text: `caption ${i}`,
        play_count: i,
        video_units_sold: 0,
        video_gmv: 0,
        creator_handle: "roxm___",
      })),
    },
  };
  const videos = mapVideoAnalysisResult(raw);
  assert.equal(videos.length, 10);
  assert.equal(videos[0].video_id, "v0");
  assert.equal(videos[0].tiktok_url, "https://www.tiktok.com/@roxm___/video/v0");
});

test("mapProductListResult tolerates an unconfirmed response shape without throwing", () => {
  assert.deepEqual(mapProductListResult({}), []);
  assert.deepEqual(mapProductListResult({ list: [] }), []);
  const mapped = mapProductListResult({ list: [{ product_id: "1", title: "Thing", price: 9.99, units_sold: 3 }] });
  assert.equal(mapped[0].product_id, "1");
  assert.equal(mapped[0].units_sold, 3);
});

test("mapProductListResult falls back to floor_price/cover_url when price/image_url are absent", () => {
  // the real case, 2026-10-15: a live @roxm___ search came back with
  // units_sold/gmv/commission_rate_percent present but price and
  // image_url both undefined -- product_rank_top_selling's confirmed
  // field names (docs/field_map.md) are the best available fallback.
  const mapped = mapProductListResult({
    list: [{ product_id: "1", title: "Thing", floor_price: 24.99, cover_url: "https://x/img.jpg", units_sold: 3, gmv: 74.97, commission_rate_percent: 15 }],
  });
  assert.equal(mapped[0].price, 24.99);
  assert.equal(mapped[0].image_url, "https://x/img.jpg");
});

test("mapProductListResult builds a price range when floor and ceiling differ", () => {
  const mapped = mapProductListResult({ list: [{ product_id: "1", title: "Thing", floor_price: 20, ceiling_price: 30 }] });
  assert.equal(mapped[0].price, "20-30");
});

test("mapProductListResult checks a nested product/shop object too", () => {
  const mapped = mapProductListResult({
    list: [{ product: { product_id: "1", title: "Nested Thing", floor_price: 5, cover_url: "https://x/nested.jpg" } }],
  });
  assert.equal(mapped[0].product_id, "1");
  assert.equal(mapped[0].title, "Nested Thing");
  assert.equal(mapped[0].price, 5);
  assert.equal(mapped[0].image_url, "https://x/nested.jpg");
});

test("isAllowedImageHost allows the FastMoss CDN and TikTok CDN hosts only", () => {
  assert.equal(isAllowedImageHost("s.500fd.com"), true);
  assert.equal(isAllowedImageHost("p16-sign-va.tiktokcdn.com"), true);
  assert.equal(isAllowedImageHost("p77-sign-va.tiktokcdn-us.com"), true);
  assert.equal(isAllowedImageHost("sometotallydifferentcdn.com"), false);
  assert.equal(isAllowedImageHost("evil.com/s.500fd.com"), false);
  assert.equal(isAllowedImageHost("not-s.500fd.com"), false);
});

test("mapFansDistributionResult extracts country/region distributions, flat or nested", () => {
  const flat = mapFansDistributionResult({
    country_distribution: [{ country: "US", percentage: 80 }, { country: "MX", percentage: 20 }],
  });
  assert.deepEqual(flat.country_distribution, [{ name: "US", percentage: 80 }, { name: "MX", percentage: 20 }]);

  const nested = mapFansDistributionResult({
    location: { country_distribution: [{ country: "US", percent: 90 }], region_distribution: [{ region: "California", percent: 30 }] },
  });
  assert.deepEqual(nested.country_distribution, [{ name: "US", percentage: 90 }]);
  assert.deepEqual(nested.region_distribution, [{ name: "California", percentage: 30 }]);
});

test("mapFansDistributionResult tolerates an unconfirmed/empty response shape", () => {
  assert.deepEqual(mapFansDistributionResult({}), { country_distribution: [], region_distribution: [] });
  assert.deepEqual(mapFansDistributionResult(null), { country_distribution: [], region_distribution: [] });
});
