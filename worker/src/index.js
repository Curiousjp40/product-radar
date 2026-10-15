import { FastMossError, callFastMossTools } from "./mcp.js";
import {
  cacheKeyFor,
  creditGuardOk,
  dailyCountKey,
  mapCreatorSearchResult,
  mapProductListResult,
  mapVideoAnalysisResult,
  mondaysRemaining,
  monthlyCountKey,
  normalizeHandle,
  searchLimitsFor,
} from "./logic.js";

const ALLOWED_ORIGIN = "https://curiousjp40.github.io";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PER_RUN_CREDIT_FLOOR = 70; // matches the weekly pipeline's --budget cap
const SEARCH_COST_CREDITS = 3; // creator_search + creator_video_analysis + creator_product_list, 1cr each
const NOT_FOUND_TTL_SECONDS = 24 * 60 * 60;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const origin = request.headers.get("Origin");
    if (origin !== ALLOWED_ORIGIN) {
      return json({ error: "forbidden" }, 403);
    }
    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    if (typeof body.password !== "string" || body.password !== env.SEARCH_PASSWORD) {
      return json({ error: "wrong password" }, 401);
    }

    const handle = normalizeHandle(body.handle);
    if (!handle) {
      return json({ error: "invalid handle" }, 400);
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
      return json({ error: "daily_limit", message: `Ya usaste tus ${dailyLimit} búsquedas de hoy.` }, 429);
    }
    if (monthlyCount >= monthlyLimit) {
      return json({ error: "monthly_limit", message: `Ya usaste tus ${monthlyLimit} búsquedas de este mes.` }, 429);
    }

    let balance;
    try {
      const [balanceResult] = await callFastMossTools(env.FASTMOSS_API_KEY, [
        { tool: "credit_usage_summary", arguments: {} },
      ]);
      balance = balanceResult?.balance?.available_credits;
    } catch (e) {
      return json({ error: "fastmoss_unavailable", message: e.message }, 502);
    }
    if (typeof balance !== "number") {
      return json({ error: "fastmoss_unavailable", message: "no balance in credit_usage_summary response" }, 502);
    }

    const { ok, floor } = creditGuardOk(balance - SEARCH_COST_CREDITS, PER_RUN_CREDIT_FLOOR, mondaysLeft);
    if (!ok) {
      return json(
        {
          error: "credit_floor",
          message: `No hay suficientes créditos de sobra (quedan ${balance}, hay que guardar al menos ${floor} para las corridas semanales).`,
        },
        429
      );
    }

    let searchRaw;
    try {
      [searchRaw] = await callFastMossTools(env.FASTMOSS_API_KEY, [
        { tool: "creator_search", arguments: { keywords: handle, filter: { unique_id: handle } } },
      ]);
    } catch (e) {
      return json({ error: "fastmoss_unavailable", message: e.message }, 502);
    }

    const creator = mapCreatorSearchResult(searchRaw);
    if (!creator) {
      await env.SEARCH_KV.put(cacheKey, JSON.stringify({ not_found: true }), { expirationTtl: NOT_FOUND_TTL_SECONDS });
      await bumpCounters(env, dailyKey, monthlyKey, dailyCount, monthlyCount);
      return json({ not_found: true, remaining_today: dailyLimit - dailyCount - 1, remaining_month: monthlyLimit - monthlyCount - 1 });
    }

    let videosRaw;
    let productsRaw;
    try {
      [videosRaw, productsRaw] = await callFastMossTools(env.FASTMOSS_API_KEY, [
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
      ]);
    } catch (e) {
      return json({ error: "fastmoss_unavailable", message: e.message }, 502);
    }

    const result = {
      creator,
      top_videos: mapVideoAnalysisResult(videosRaw),
      top_products: mapProductListResult(productsRaw),
      fetched_at: now.toISOString(),
    };

    await env.SEARCH_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
    await bumpCounters(env, dailyKey, monthlyKey, dailyCount, monthlyCount);

    return json({ ...result, from_cache: false, remaining_today: dailyLimit - dailyCount - 1, remaining_month: monthlyLimit - monthlyCount - 1 });
  },
};

async function bumpCounters(env, dailyKey, monthlyKey, dailyCount, monthlyCount) {
  await Promise.all([
    env.SEARCH_KV.put(dailyKey, String(dailyCount + 1), { expirationTtl: 2 * 24 * 60 * 60 }),
    env.SEARCH_KV.put(monthlyKey, String(monthlyCount + 1), { expirationTtl: 35 * 24 * 60 * 60 }),
  ]);
}

export { FastMossError };
