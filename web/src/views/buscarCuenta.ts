import { t, type Lang } from "../i18n";
import type { AccountSearchResult } from "../types";

/* "Buscar cuenta" -- replaces the old "Cómo te está yendo" / Ari-benchmark
 * page (2026-10-15). Looks up ANY TikTok account's public-ish FastMoss
 * numbers (sales, top videos, top products), gated by a shared password and
 * a daily/monthly search budget, all enforced server-side by the Cloudflare
 * Worker in /worker (the FastMoss key can never live in this static site).
 *
 * WORKER_URL is set once the Worker is deployed (see the setup walkthrough
 * in the PR/commit this shipped with). Until then, the page only offers the
 * free "open in TikTok" button -- no password gate, no fetch attempt. */
const WORKER_URL = "https://product-radar-search.roxie-radar.workers.dev";

const PASSWORD_KEY = "product-radar:search-password";

function getStoredPassword(): string | null {
  try {
    return localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

function setStoredPassword(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PASSWORD_KEY);
    else localStorage.setItem(PASSWORD_KEY, value);
  } catch {
    // storage unavailable (private mode, blocked site data) -- she'll just
    // be asked again next visit, the page still works either way.
  }
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function tiktokProfileUrl(handle: string): string {
  return `https://www.tiktok.com/@${handle}`;
}

function fastmossProductUrl(productId: string): string {
  return `https://www.fastmoss.com/e-commerce/detail/${productId}`;
}

// price can be a number, a "$"-formatted string, a plain numeric string, or
// a "low-high" range (worker/src/logic.js's mapProductListResult, still an
// inferred field mapping -- see its comment) -- always degrade to an em
// dash rather than ever rendering "$undefined" (the real bug this fixes).
function formatPrice(price: number | string | null | undefined): string {
  if (price === null || price === undefined) return "—";
  if (typeof price === "number") return `$${price.toFixed(2)}`;
  const trimmed = price.trim();
  if (trimmed.startsWith("$")) return trimmed;
  if (trimmed.includes("-")) {
    const [lo, hi] = trimmed.split("-").map((p) => Number(p.trim()));
    if (Number.isFinite(lo) && Number.isFinite(hi)) return `$${lo.toFixed(2)} - $${hi.toFixed(2)}`;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : "—";
}

function searchWord(n: number, lang: Lang): string {
  if (lang === "es") return n === 1 ? "búsqueda" : "búsquedas";
  return n === 1 ? "search" : "searches";
}

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; handle: string }
  | { kind: "result"; handle: string; data: AccountSearchResult }
  | { kind: "not_found"; handle: string }
  | { kind: "no_worker"; handle: string }
  | { kind: "error"; handle: string; message: string };

let state: ViewState = { kind: "idle" };
let remainingToday: number | null = null;
let remainingMonth: number | null = null;

function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

function freeButtonsHtml(handle: string, lang: Lang): string {
  if (!handle) return "";
  return `
    <div class="free-buttons">
      <a href="${tiktokProfileUrl(handle)}" target="_blank" rel="noopener">${t("view_profile_tiktok", lang)}</a>
    </div>
  `;
}

function remainingHtml(lang: Lang): string {
  if (remainingToday === null || remainingMonth === null) return "";
  // When the monthly cap is the binding constraint (e.g. the tightened
  // 2/month phase until the Nov 15 reset), a separate "today" number
  // would overstate what's really left -- just state the real limit.
  const text =
    remainingMonth <= remainingToday
      ? lang === "es"
        ? `Te quedan ${remainingMonth} ${searchWord(remainingMonth, lang)} este mes.`
        : `You have ${remainingMonth} ${searchWord(remainingMonth, lang)} left this month.`
      : lang === "es"
        ? `Te quedan ${remainingToday} ${searchWord(remainingToday, lang)} hoy, ${remainingMonth} este mes.`
        : `You have ${remainingToday} ${searchWord(remainingToday, lang)} left today, ${remainingMonth} this month.`;
  return `<p class="search-remaining">${text}</p>`;
}

function creatorStatsHtml(data: AccountSearchResult, lang: Lang): string {
  const c = data.creator;
  const categories = c.trend_categories.map((cat) => cat.name).join(", ") || "—";
  return `
    <div class="insight-card">
      <div class="search-profile">
        ${c.avatar ? `<img class="search-avatar" src="${c.avatar}" alt="${c.nickname}" />` : ""}
        <div>
          <h3>${c.nickname}</h3>
          <span class="text-dim">@${c.unique_id}</span>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${formatCount(c.follower_count)}</b><span>${t("followers_label", lang)}</span></div>
        <div class="stat"><b>$${c.day28_gmv.toFixed(0)}</b><span>${t("sales_28d_label", lang)}</span></div>
        <div class="stat"><b>${c.day28_units_sold}</b><span>${t("units_label", lang)}</span></div>
        <div class="stat"><b>${c.day28_video_count}</b><span>${t("videos_posted_label", lang)}</span></div>
        <div class="stat"><b>${formatCount(c.video_avg_play_count)}</b><span>${t("avg_views_label", lang)}</span></div>
      </div>
      <p class="text-dim">${t("top_categories_label", lang)}: ${categories}</p>
    </div>
  `;
}

function barRow(label: string, pct: number): string {
  return `
    <div class="bar-row">
      <span class="bar-label">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(Math.max(pct, 0), 100)}%"></div></div>
      <span class="bar-pct">${pct.toFixed(0)}%</span>
    </div>
  `;
}

function audienceHtml(data: AccountSearchResult, lang: Lang): string {
  const c = data.creator;
  if (c.age_distribution.length === 0 && c.gender_distribution.length === 0) return "";
  return `
    <div class="insight-card">
      <h3>${t("audience_label", lang)}</h3>
      ${c.age_distribution.map((a) => barRow(a.age_range, a.percentage)).join("")}
      ${c.gender_distribution.length > 0 ? `<div class="bar-group-gap"></div>${c.gender_distribution.map((g) => barRow(g.gender, g.percentage)).join("")}` : ""}
    </div>
  `;
}

function topVideosHtml(data: AccountSearchResult, lang: Lang): string {
  if (data.top_videos.length === 0) return "";
  return `
    <div class="insight-card">
      <h3>${t("top_videos_label", lang)}</h3>
      <div class="todos-list">
        ${data.top_videos
          .map(
            (v) => `
          <a class="todos-row" href="${v.tiktok_url ?? "#"}" target="_blank" rel="noopener">
            <div class="photo video-photo-placeholder">&#9654;</div>
            <div class="info">
              <div class="name">${v.caption_text.slice(0, 50) || "..."}</div>
              <div class="meta">${formatCount(v.play_count)} ${t("views_short", lang)} &middot; ${v.video_units_sold} ${t("sales_short", lang)}</div>
            </div>
          </a>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function topProductsHtml(data: AccountSearchResult, lang: Lang): string {
  if (data.top_products.length === 0) return "";
  return `
    <div class="insight-card">
      <h3>${t("top_products_label", lang)}</h3>
      <div class="todos-list">
        ${data.top_products
          .map(
            (p) => `
          <a class="todos-row" href="${fastmossProductUrl(p.product_id)}" target="_blank" rel="noopener">
            ${p.image_url ? `<img class="photo" src="${p.image_url}" alt="" loading="lazy" />` : `<div class="photo"></div>`}
            <div class="info">
              <div class="name">${p.title.slice(0, 50)}</div>
              <div class="meta">${formatPrice(p.price)} &middot; ${p.units_sold ?? "—"} ${t("units_sold_short", lang)} &middot; ${p.commission_rate_percent != null ? `${p.commission_rate_percent}%` : "—"}</div>
            </div>
          </a>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderBody(lang: Lang): string {
  if (state.kind === "idle") {
    return `
      <form class="search-box" id="search-form">
        <input type="text" id="search-input" placeholder="@usuario" autocomplete="off" />
        <button type="submit" class="btn-accent">${t("search_button", lang)}</button>
      </form>
      ${remainingHtml(lang)}
    `;
  }

  if (state.kind === "loading") {
    return `
      <form class="search-box" id="search-form">
        <input type="text" id="search-input" value="@${state.handle}" autocomplete="off" />
        <button type="submit" class="btn-accent" disabled>...</button>
      </form>
      <p class="empty-state">${t("searching", lang)}</p>
    `;
  }

  const handle = state.handle;
  let resultBlock = "";
  if (state.kind === "no_worker") {
    resultBlock = freeButtonsHtml(handle, lang);
  } else if (state.kind === "not_found") {
    resultBlock = `<p class="empty-state">${t("account_not_found", lang)}</p>${freeButtonsHtml(handle, lang)}`;
  } else if (state.kind === "error") {
    resultBlock = `<p class="empty-state">${state.message}</p>${freeButtonsHtml(handle, lang)}`;
  } else if (state.kind === "result") {
    resultBlock = `
      ${freeButtonsHtml(handle, lang)}
      ${creatorStatsHtml(state.data, lang)}
      ${audienceHtml(state.data, lang)}
      ${topVideosHtml(state.data, lang)}
      ${topProductsHtml(state.data, lang)}
    `;
  }

  return `
    <form class="search-box" id="search-form">
      <input type="text" id="search-input" value="@${handle}" autocomplete="off" />
      <button type="submit" class="btn-accent">${t("search_button", lang)}</button>
    </form>
    ${remainingHtml(lang)}
    ${resultBlock}
  `;
}

async function runSearch(container: HTMLElement, lang: Lang, handle: string): Promise<void> {
  if (!WORKER_URL) {
    state = { kind: "no_worker", handle };
    render(container, lang);
    return;
  }

  let password = getStoredPassword();
  if (!password) {
    const entered = window.prompt(t("enter_password_prompt", lang));
    if (!entered) return;
    password = entered;
  }

  state = { kind: "loading", handle };
  render(container, lang);

  try {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, password }),
    });
    const data: AccountSearchResult = await resp.json();

    if (resp.status === 401) {
      setStoredPassword(null);
      state = { kind: "error", handle, message: t("wrong_password", lang) };
      render(container, lang);
      return;
    }

    setStoredPassword(password);
    remainingToday = data.remaining_today ?? remainingToday;
    remainingMonth = data.remaining_month ?? remainingMonth;

    if (!resp.ok) {
      state = { kind: "error", handle, message: data.message || t("search_failed", lang) };
    } else if (data.not_found) {
      state = { kind: "not_found", handle };
    } else {
      state = { kind: "result", handle, data };
    }
  } catch {
    state = { kind: "error", handle, message: t("search_failed", lang) };
  }
  render(container, lang);
}

function render(container: HTMLElement, lang: Lang): void {
  container.innerHTML = `
    <h2 class="view-title">${t("buscar_cuenta_title", lang)}</h2>
    ${renderBody(lang)}
  `;
  const form = container.querySelector<HTMLFormElement>("#search-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = container.querySelector<HTMLInputElement>("#search-input");
    const handle = normalizeHandleInput(input?.value ?? "");
    if (!handle) return;
    void runSearch(container, lang, handle);
  });
}

export function renderBuscarCuenta(container: HTMLElement, lang: Lang): void {
  render(container, lang);
}
