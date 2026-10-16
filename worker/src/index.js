import { FastMossError, callFastMossTools } from "./mcp.js";
import {
  cacheKeyFor,
  clientIp,
  countsAgainstQuota,
  creditGuardOk,
  dailyCountKey,
  evaluateLoginAttempt,
  isAllowedImageHost,
  mapCreatorSearchResult,
  mapFansDistributionResult,
  mapProductListResult,
  mapVideoAnalysisResult,
  mondaysRemaining,
  monthlyCountKey,
  normalizeHandle,
  RATE_LIMIT_FAIL_WINDOW_SECONDS,
  RATE_LIMIT_LOCKOUT_SECONDS,
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
const SAVED_KEY_PREFIX = "saved:";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Password",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// Privacy fix (2026-10-16): GET /state, /saved and /credits used to trust
// Origin alone -- but Origin is just a browser-sent header on the real
// request from the real public site, so ANY visitor's normal page load
// sent it and got Roxie's real Mis Productos/earnings/goal/hidden/
// not_for_me data back. Origin still restricts WHICH SITE can call these
// (not a random third-party page), but it is not a secret and proves
// nothing about WHO is visiting that site -- a real password, sent as a
// header (not a URL query param, which can leak into logs/referrers), is
// the actual gate now for anything that isn't plain shared product data.
//
// Brute-force protection (same date): every password-checked route calls
// this instead of comparing the password itself, so a guesser can't just
// hammer one of the GET routes to avoid the POST routes' slower FastMoss
// round-trip. Policy itself (when to lock out, when to clear) is
// evaluateLoginAttempt in logic.js, kept pure/testable; this just does the
// KV reads/writes it asks for.
async function checkPassword(request, env, candidatePassword) {
  const ip = clientIp(request);
  const lockoutKey = `lockout:${ip}`;
  const failKey = `failcount:${ip}`;
  const [lockedRaw, failRaw] = await Promise.all([env.SEARCH_KV.get(lockoutKey), env.SEARCH_KV.get(failKey)]);
  const lockedOut = lockedRaw !== null;
  const failCount = parseInt(failRaw || "0", 10);
  const passwordCorrect = typeof candidatePassword === "string" && candidatePassword.length > 0 && candidatePassword === env.SEARCH_PASSWORD;
  const result = evaluateLoginAttempt(lockedOut, failCount, passwordCorrect);

  if (result.kvAction === "clear") {
    await env.SEARCH_KV.delete(failKey);
  } else if (result.kvAction === "increment") {
    await env.SEARCH_KV.put(failKey, String(result.newCount), { expirationTtl: RATE_LIMIT_FAIL_WINDOW_SECONDS });
  } else if (result.kvAction === "lockout") {
    await Promise.all([
      env.SEARCH_KV.put(lockoutKey, "1", { expirationTtl: RATE_LIMIT_LOCKOUT_SECONDS }),
      env.SEARCH_KV.delete(failKey),
    ]);
  }

  return { allow: result.allow, status: result.status };
}

function passwordErrorResponse(status) {
  return json({ error: status === 429 ? "too_many_attempts" : "wrong_password" }, status);
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
    if (url.pathname === "/saved") {
      return handleSaved(request, url, env);
    }
    if (url.pathname === "/admin/mis-productos") {
      return handleAdminMisProductos(request, url, env);
    }
    return handleSearch(request, env);
  },
};

/**
 * Part C8: the weekly pipeline (engine/earnings.py, run from GitHub
 * Actions, no browser/Origin) needs to read Mis Productos' earnings data
 * to start collecting outcome data for Phase 3 -- a different trust
 * boundary than the frontend's own free /state?key=mis_productos read
 * (that one trusts Origin; GitHub Actions has no Origin header at all),
 * so this is a separate route gated by a bearer token (env.ADMIN_READ_TOKEN,
 * the GitHub secret MIS_PRODUCTOS_TOKEN) instead of Origin/CORS.
 */
async function handleAdminMisProductos(request, url, env) {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token");
  if (!token || token !== env.ADMIN_READ_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  // Profile-namespaced (2026-10-16, see handleState's own comment) --
  // falls back to the pre-profile flat key so this keeps working during
  // the gap between this deploy and the next frontend sync write/read
  // migrating the data into state:roxie:mis_productos.
  let stored = await env.SEARCH_KV.get(`state:${DEFAULT_PROFILE_ID}:mis_productos`, { type: "json" });
  if (stored === null) {
    stored = await env.SEARCH_KV.get("state:mis_productos", { type: "json" });
  }
  return json({ data: stored ?? [] });
}

/**
 * Part C6b: every successful search (cache hit or fresh fetch) is also
 * saved permanently under `saved:<handle>` (no expirationTtl, unlike the
 * 7-day `cache:<handle>` dedup key) with a small `metadata` blob so the
 * saved-searches list can be built from one env.SEARCH_KV.list() call
 * without reading every saved value.
 */
async function saveSearchResult(env, handle, result) {
  await env.SEARCH_KV.put(`${SAVED_KEY_PREFIX}${handle}`, JSON.stringify(result), {
    metadata: {
      handle,
      nickname: result.creator?.nickname ?? handle,
      avatar: result.creator?.avatar ?? null,
      fetched_at: result.fetched_at,
    },
  });
}

/**
 * Part C6b: GET /saved lists every saved search (free -- just KV reads,
 * no FastMoss calls), GET /saved?handle=X returns one saved search's full
 * result (also free -- "opening a saved one costs 0 credits"). Password-
 * gated as of the 2026-10-16 privacy fix: this is Roxie's own research
 * history (who she's scouted, with real account data), not public product
 * data, so CORS + Origin alone isn't enough -- see checkPassword.
 */
async function handleSaved(request, url, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const origin = request.headers.get("Origin");
  if (origin !== ALLOWED_ORIGIN) {
    return json({ error: "forbidden" }, 403);
  }
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const savedCheck = await checkPassword(request, env, request.headers.get("X-Sync-Password"));
  if (!savedCheck.allow) return passwordErrorResponse(savedCheck.status);

  const handle = url.searchParams.get("handle");
  if (handle) {
    const result = await env.SEARCH_KV.get(`${SAVED_KEY_PREFIX}${handle}`, { type: "json" });
    if (!result) return json({ error: "not_saved" }, 404);
    return json(result);
  }

  const listed = await env.SEARCH_KV.list({ prefix: SAVED_KEY_PREFIX });
  const items = listed.keys.map((k) => k.metadata ?? { handle: k.name.slice(SAVED_KEY_PREFIX.length) });
  return json({ items });
}

// Part C5/C4's cross-device sync: Mis Productos, "No me interesa" and "Mi
// lista" all need to work the same on Roxie's phone and the computer, not
// just in one browser's localStorage. One generic key-value route instead
// of bespoke routes per feature -- each of these is "one JSON blob for a
// known key", nothing more. Both reads and writes require SEARCH_PASSWORD
// (2026-10-16 privacy fix -- see checkPassword's own comment for why
// Origin alone wasn't enough): this is Roxie's real inventory/earnings/
// hidden-item data, not something any site visitor should be able to read.
const STATE_ALLOWED_KEYS = new Set(["mis_productos", "not_for_me", "mi_lista", "hidden_categories", "earnings_goal"]);

// Future-proofing for multiple users (2026-10-16): every synced key now
// lives under a profile id (state:<profileId>:<key>) instead of a flat
// state:<key>, so a real login system can be dropped in later without
// re-keying any data -- Roxie is just profile "roxie" for now, same
// shared password as before (no accounts yet). DEFAULT_PROFILE_ID is also
// the fallback for any client that hasn't picked up the ?profile= param
// yet (old cached JS, a stale service worker, etc.), so nothing silently
// stops syncing on deploy.
const DEFAULT_PROFILE_ID = "roxie";
const PROFILE_ID_RE = /^[a-z0-9_-]{1,40}$/;

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
  const profileParam = url.searchParams.get("profile");
  const profileId = profileParam && PROFILE_ID_RE.test(profileParam) ? profileParam : DEFAULT_PROFILE_ID;
  const kvKey = `state:${profileId}:${key}`;

  if (request.method === "GET") {
    const stateGetCheck = await checkPassword(request, env, request.headers.get("X-Sync-Password"));
    if (!stateGetCheck.allow) return passwordErrorResponse(stateGetCheck.status);
    let stored = await env.SEARCH_KV.get(kvKey, { type: "json" });
    if (stored === null) {
      // One-time read-migration: data written before profiles existed
      // lived at the flat state:<key> -- pull it into this profile's own
      // key on first read so it isn't orphaned by the rename.
      const legacy = await env.SEARCH_KV.get(`state:${key}`, { type: "json" });
      if (legacy !== null) {
        await env.SEARCH_KV.put(kvKey, JSON.stringify(legacy));
        stored = legacy;
      }
    }
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
  const statePostCheck = await checkPassword(request, env, body.password);
  if (!statePostCheck.allow) return passwordErrorResponse(statePostCheck.status);
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
 * Password-gated as of the 2026-10-16 privacy fix: Ryan's FastMoss plan
 * balance is his own business info, not public product data.
 */
async function handleCredits(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const creditsCheck = await checkPassword(request, env, request.headers.get("X-Sync-Password"));
  if (!creditsCheck.allow) return passwordErrorResponse(creditsCheck.status);
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

  const searchCheck = await checkPassword(request, env, body.password);
  if (!searchCheck.allow) return passwordErrorResponse(searchCheck.status);

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
    if (cached.creator) await saveSearchResult(env, handle, cached);
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
  await saveSearchResult(env, handle, result);
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
