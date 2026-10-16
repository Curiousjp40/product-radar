import { FastMossError, callFastMossTools } from "./mcp.js";
import {
  cacheKeyFor,
  countsAgainstQuota,
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
} from "./logic.js";

const ALLOWED_ORIGIN = "https://curiousjp40.github.io";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const IMAGE_CACHE_CONTROL = "public, max-age=604800"; // 7 days, matches CACHE_TTL_SECONDS
// Matches the floor Ryan set for the Part C1 video backfill decision
// (2026-10-15: "60 x Mondays left before the reset") -- kept as one shared
// number so the search guard and the backfill go/no-stop check always
// agree on what "enough left for Monday's run" means.
const PER_RUN_CREDIT_FLOOR = 60;
// creator_search(1) + creator_video_analysis(1) + creator_product_list(1) +
// creator_fans_distribution(2, location data -- added 2026-10-15, see
// docs/fastmoss_tools.json) = 5cr/search.
const SEARCH_COST_CREDITS = 5;
const NOT_FOUND_TTL_SECONDS = 24 * 60 * 60;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/img") {
      return handleImageProxy(request, url, ctx);
    }
    if (url.pathname === "/credits") {
      return handleCredits(request, env);
    }
    if (url.pathname === "/state") {
      return handleState(request, url, env);
    }
    return handleSearch(request, env);
  },
};

// Part C5/C4's cross-device sync: Mis Productos, "No me interesa" and "Mi
// lista" all need to work the same on Roxie's phone and the computer, not
// just in one browser's localStorage. One generic key-value route instead
// of bespoke routes per feature -- each of these is "one JSON blob for a
// known key", nothing more. Reads need no password (CORS + Origin check
// already restrict this to the Pages site); writes need the same
// SEARCH_PASSWORD as account search, since a write can overwrite real data.
const STATE_ALLOWED_KEYS = new Set(["mis_productos", "not_for_me", "mi_lista", "hidden_categories"]);

async function handleState(request, url, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const origin = request.headers.get("Origin");
  if (origin !== ALLOWED_ORIGIN) {
    return json({ error: "forbidden" }, 403);
  }
  const key = url.searchParams.get("key");
  if (!key || !STATE_ALLOWED_KEYS.has(key)) {
    return json({ error: "invalid_key" }, 400);
  }
  const kvKey = `state:${key}`;

  if (request.method === "GET") {
    const stored = await env.SEARCH_KV.get(kvKey, { type: "json" });
    return json({ data: stored }); // null when nothing's been synced yet
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (typeof body.password !== "string" || body.password !== env.SEARCH_PASSWORD) {
    return json({ error: "wrong_password" }, 401);
  }
  if (!("data" in body)) {
    return json({ error: "missing_data" }, 400);
  }
  await env.SEARCH_KV.put(kvKey, JSON.stringify(body.data));
  return json({ ok: true });
}

const CREDITS_CACHE_KEY = "cache:credit_usage_summary";
const CREDITS_CACHE_TTL_SECONDS = 15 * 60; // credit_usage_summary is free, but no reason to hit it every page load

/**
 * Part C1g: a "Más" credits widget needs the real balance, but the
 * frontend is a static site with no FastMoss key of its own -- it has to
 * go through this Worker, same as account search. credit_usage_summary
 * itself is free/read-only (0 credits, same exemption CLAUDE.md gives
 * engine.run), so this never touches the paid-call guard; it's just
 * cached for 15 minutes so a page full of visits doesn't hammer FastMoss.
 */
async function handleCredits(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const cached = await env.SEARCH_KV.get(CREDITS_CACHE_KEY, { type: "json" });
  if (cached) return json(cached);

  try {
    const [summary] = await callFastMossTools(env.FASTMOSS_API_KEY, [{ tool: "credit_usage_summary", arguments: {} }]);
    await env.SEARCH_KV.put(CREDITS_CACHE_KEY, JSON.stringify(summary), { expirationTtl: CREDITS_CACHE_TTL_SECONDS });
    return json(summary);
  } catch (e) {
    const message = e instanceof FastMossError ? e.message : "unexpected error";
    return json({ error: message }, 502);
  }
}

/**
 * Proxies an image from an allowlisted CDN host (added 2026-10-15: FastMoss's
 * own CDN, s.500fd.com, blocks hotlinking from other origins -- a
 * server-side Worker fetch isn't subject to that). Never a general-purpose
 * proxy: `isAllowedImageHost` refuses anything else. Cached at Cloudflare's
 * edge (Cache API, not KV -- built for exactly this) for 7 days, so a
 * repeat view costs nothing, same as the search result cache. Zero FastMoss
 * calls -- this never touches the FastMoss API at all.
 */
async function handleImageProxy(request, url, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const target = url.searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400 });

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  if (targetUrl.protocol !== "https:" || !isAllowedImageHost(targetUrl.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString());
  } catch (e) {
    return new Response(`upstream fetch failed: ${e.message}`, { status: 502 });
  }
  if (!upstream.ok) {
    return new Response("upstream error", { status: 502 });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
  headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);

  const response = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleSearch(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const origin = request.headers.get("Origin");
  if (origin !== ALLOWED_ORIGIN) {
    return json({ error: "forbidden" }, 403);
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (typeof body.password !== "string" || body.password !== env.SEARCH_PASSWORD) {
    return json({ error: "wrong_password" }, 401);
  }

  const handle = normalizeHandle(body.handle);
  if (!handle) {
    return json({ error: "invalid_handle" }, 400);
  }

  const now = new Date();
  const resetDate = new Date(`${env.CREDIT_RESET_DATE}T00:00:00Z`);
  const { daily: dailyLimit, monthly: monthlyLimit } = searchLimitsFor(now, resetDate);
  const mondaysLeft = Math.max(mondaysRemaining(now, resetDate), 1); // never divide the floor away to zero post-reset

  const dailyKey = dailyCountKey(now);
  const monthlyKey = monthlyCountKey(now);
  const [dailyCountRaw, monthlyCountRaw] = await Promise.all([
    env.SEARCH_KV.get(dailyKey),
    env.SEARCH_KV.get(monthlyKey),
  ]);
  const dailyCount = parseInt(dailyCountRaw || "0", 10);
  const monthlyCount = parseInt(monthlyCountRaw || "0", 10);

  const cacheKey = cacheKeyFor(handle);
  const cached = await env.SEARCH_KV.get(cacheKey, { type: "json" });
  if (cached) {
    return json({ ...cached, from_cache: true, remaining_today: dailyLimit - dailyCount, remaining_month: monthlyLimit - monthlyCount });
  }

  if (dailyCount >= dailyLimit) {
    return json({ error: "daily_limit", params: { limit: dailyLimit } }, 429);
  }
  if (monthlyCount >= monthlyLimit) {
    return json({ error: "monthly_limit", params: { limit: monthlyLimit } }, 429);
  }

  let balance;
  try {
    const [balanceResult] = await callFastMossTools(env.FASTMOSS_API_KEY, [
      { tool: "credit_usage_summary", arguments: {} },
    ]);
    balance = balanceResult?.balance?.available_credits;
  } catch (e) {
    return json({ error: "fastmoss_unavailable", detail: e.message }, 502);
  }
  if (typeof balance !== "number") {
    return json({ error: "fastmoss_unavailable", detail: "no balance in credit_usage_summary response" }, 502);
  }

  const { ok, floor } = creditGuardOk(balance - SEARCH_COST_CREDITS, PER_RUN_CREDIT_FLOOR, mondaysLeft);
  if (!ok) {
    return json({ error: "credit_floor", params: { balance, floor } }, 429);
  }

  let searchRaw;
  try {
    [searchRaw] = await callFastMossTools(env.FASTMOSS_API_KEY, [
      { tool: "creator_search", arguments: { keywords: handle, filter: { unique_id: handle } } },
    ]);
  } catch (e) {
    return json({ error: "fastmoss_unavailable", detail: e.message }, 502);
  }

  const creator = mapCreatorSearchResult(searchRaw);
  if (!creator) {
    await env.SEARCH_KV.put(cacheKey, JSON.stringify({ not_found: true }), { expirationTtl: NOT_FOUND_TTL_SECONDS });
    if (countsAgainstQuota("not_found")) {
      await bumpCounters(env, dailyKey, monthlyKey, dailyCount, monthlyCount);
    }
    return json({ not_found: true, remaining_today: dailyLimit - dailyCount, remaining_month: monthlyLimit - monthlyCount });
  }

  let videosRaw;
  let productsRaw;
  let fansRaw;
  try {
    [videosRaw, productsRaw, fansRaw] = await callFastMossTools(env.FASTMOSS_API_KEY, [
      {
        tool: "creator_video_analysis",
        arguments: {
          filter: { uid: creator.uid, time_range_days: 28, pagesize: 10, orderby: [{ field: "sale_amount", order: "desc" }] },
        },
      },
      {
        tool: "creator_product_list",
        arguments: {
          filter: { uid: creator.uid, time_range_days: "28" },
          orderby: [{ field: "units_sold", order: "desc" }],
          pagesize: 10,
        },
      },
      { tool: "creator_fans_distribution", arguments: { filter: { uid: creator.uid } } },
    ]);
  } catch (e) {
    return json({ error: "fastmoss_unavailable", detail: e.message }, 502);
  }

  const location = mapFansDistributionResult(fansRaw);
  const result = {
    creator: { ...creator, ...location },
    top_videos: mapVideoAnalysisResult(videosRaw),
    top_products: mapProductListResult(productsRaw),
    fetched_at: now.toISOString(),
  };

  await env.SEARCH_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
  await bumpCounters(env, dailyKey, monthlyKey, dailyCount, monthlyCount);

  return json({ ...result, from_cache: false, remaining_today: dailyLimit - dailyCount - 1, remaining_month: monthlyLimit - monthlyCount - 1 });
}

async function bumpCounters(env, dailyKey, monthlyKey, dailyCount, monthlyCount) {
  await Promise.all([
    env.SEARCH_KV.put(dailyKey, String(dailyCount + 1), { expirationTtl: 2 * 24 * 60 * 60 }),
    env.SEARCH_KV.put(monthlyKey, String(monthlyCount + 1), { expirationTtl: 35 * 24 * 60 * 60 }),
  ]);
}

export { FastMossError };
