import { loadHooks, loadPicks, loadSeasons } from "../api";
import { assetUrl } from "../asset";
import { addEntry, getEntries, getMonthlyGoal, setMonthlyGoal } from "../earningsGoal";
import { bestCategoryForGoal, earningsProgress, earningsThisMonth, videosNeeded } from "../earningsGoalLogic";
import { t, type Lang } from "../i18n";
import { getAllStatuses, setStatus } from "../pipeline";
import { productsToFilmToday } from "../rotation";
import { getAllSamples, hasRequestedSample, requestSample } from "../samples";
import { hasUrgentSamples } from "../samplesLogic";
import type { HooksFile, Pick } from "../types";
import { countdownText, daysUntil } from "./season";

// A deterministic-per-day pick from a list (e.g. "today's" template hook),
// using the same day-number approach as rotation.ts -- not random, so the
// suggestion doesn't flicker on every re-render, but still varies day to day.
function pickForToday<T>(items: T[], today: Date): T | null {
  if (items.length === 0) return null;
  const dayNumber = Math.floor(today.getTime() / 86_400_000);
  return items[dayNumber % items.length];
}

async function seasonCountdownHtml(lang: Lang): Promise<string> {
  const { data } = await loadSeasons();
  const upcoming = data.events
    .filter((ev) => ev.film_end && (daysUntil(ev.film_end) ?? -1) >= 0)
    .sort((a, b) => (daysUntil(a.film_end) ?? Infinity) - (daysUntil(b.film_end) ?? Infinity));
  if (upcoming.length === 0) return "";
  const next = upcoming[0];
  const label = lang === "es" ? next.label_es : next.label_en;
  return `<p class="hoy-season-countdown">${label}: ${countdownText(next, lang)}</p>`;
}

function bestHook(pick: Pick, hooks: HooksFile, today: Date, lang: Lang): string {
  const real = pick.formula_ganadora?.top_hooks[0];
  if (real) return real;
  const templates = hooks.hooks[pick.category]?.[lang] ?? [];
  return pickForToday(templates, today) ?? "";
}

function hashtagsHtml(pick: Pick, lang: Lang, limit: number): string {
  const tags = (pick.formula_ganadora?.top_hashtags ?? []).slice(0, limit);
  if (tags.length === 0) return "";
  return `
    <div class="hoy-hashtags">
      <div class="formula-section-head">
        <span class="formula-label">${t("top_hashtags_label", lang)}</span>
        <button type="button" class="copy-hashtags-btn" data-hashtags="${tags.map((h) => `#${h.hashtag}`).join(" ")}">${t("copy_all_button", lang)}</button>
      </div>
      <div class="hashtag-chips">${tags.map((h) => `<span class="hashtag-chip">#${h.hashtag}</span>`).join("")}</div>
    </div>
  `;
}

function shotListDetailsHtml(pick: Pick, hooks: HooksFile, lang: Lang): string {
  const archetype = hooks.category_to_shot_list[pick.category];
  const steps = archetype ? (hooks.shot_lists[archetype]?.[lang] ?? []) : [];
  if (steps.length === 0) return "";
  return `
    <details class="hoy-shot-list-details">
      <summary>${t("shot_list_label", lang)}</summary>
      <ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
    </details>
  `;
}

function actionButtons(pick: Pick, lang: Lang, filmed: boolean): string {
  const requested = hasRequestedSample(pick.product_id);
  return `
    <div class="card-actions">
      <a class="btn-primary" href="${pick.tiktok_shop_url}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
      <a class="btn-save-pill" href="#/product/${pick.product_id}">${t("see_selling_videos_button", lang)}</a>
      <button
        type="button"
        class="btn-mark-filmed ${filmed ? "active" : ""}"
        data-action="mark-filmed"
        data-product-id="${pick.product_id}"
        ${filmed ? "disabled" : ""}
      >${filmed ? t("marked_filmed_label", lang) : t("mark_filmed_button", lang)}</button>
      <button
        type="button"
        class="btn-request-sample ${requested ? "active" : ""}"
        data-action="request-sample"
        data-product-id="${pick.product_id}"
        data-price="${pick.price}"
        data-name="${pick.clean_title.replace(/"/g, "&quot;")}"
        ${requested ? "disabled" : ""}
      >${requested ? t("sample_requested_label", lang) : t("request_sample_button", lang)}</button>
    </div>
  `;
}

// The hero: one big "film this today" pick -- photo, earnings, the one
// reason it's the pick, the best hook, hashtags, shot list behind a tap.
function heroHtml(pick: Pick, hooks: HooksFile, today: Date, lang: Lang, filmed: boolean): string {
  const earnLine = t("earn_headline", lang, { amount: pick.earnings_per_sale.toFixed(2) });
  const why = lang === "es" ? pick.summary_es : pick.summary_en;
  const hook = bestHook(pick, hooks, today, lang);
  return `
    <article class="hoy-hero" data-product-id="${pick.product_id}">
      <a class="hoy-hero-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="hoy-hero-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" loading="lazy" />` : `<div class="hoy-hero-photo hoy-hero-photo-placeholder"></div>`}
      </a>
      <div class="hoy-hero-body">
        <span class="hoy-hero-eyebrow">${t("hoy_hero_label", lang)}</span>
        <h3 class="hoy-hero-title">${pick.clean_title}</h3>
        <div class="hoy-hero-earn">${earnLine}</div>
        ${why ? `<p class="hoy-hero-why">${why}</p>` : ""}
        ${hook ? `<p class="hoy-hook-real">&ldquo;${hook}&rdquo;</p>` : ""}
        ${hashtagsHtml(pick, lang, 5)}
        ${shotListDetailsHtml(pick, hooks, lang)}
        ${actionButtons(pick, lang, filmed)}
      </div>
    </article>
  `;
}

// "Also good" -- smaller, condensed versions of the same card.
function alsoGoodCardHtml(pick: Pick, hooks: HooksFile, today: Date, lang: Lang, filmed: boolean): string {
  const earnLine = t("earn_headline", lang, { amount: pick.earnings_per_sale.toFixed(2) });
  const hook = bestHook(pick, hooks, today, lang);
  return `
    <article class="pick-card hoy-also-good" data-product-id="${pick.product_id}">
      <a class="card-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="card-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" loading="lazy" />` : `<div class="card-photo card-photo-placeholder"></div>`}
      </a>
      <div class="card-body">
        <h3 class="card-title">${pick.clean_title}</h3>
        <div class="card-earn">${earnLine}</div>
        ${hook ? `<p class="hoy-hook-real">&ldquo;${hook}&rdquo;</p>` : ""}
        ${hashtagsHtml(pick, lang, 3)}
        ${shotListDetailsHtml(pick, hooks, lang)}
        ${actionButtons(pick, lang, filmed)}
      </div>
    </article>
  `;
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// H1 earnings goal card, shown at the top of Hoy. Logging a sale and
// setting the goal are both inline forms toggled open/closed, same pattern
// as Muestras' add-sample form.
function goalCardHtml(lang: Lang, picks: Pick[], today: Date): string {
  const goal = getMonthlyGoal();
  const earned = earningsThisMonth(getEntries(), today);
  const progress = earningsProgress(goal, earned);

  if (!progress) {
    return `
      <div class="insight-card earnings-goal-card">
        <h3>${t("earnings_goal_title", lang)}</h3>
        <p class="empty-state" style="padding:4px 0">${t("earnings_goal_no_goal", lang)}</p>
        <form class="earnings-goal-form" data-form="set-goal">
          <input type="number" min="0" step="1" name="goal" placeholder="${t("earnings_goal_set_label", lang)}" required />
          <button type="submit" class="btn-primary">${t("earnings_goal_save_button", lang)}</button>
        </form>
      </div>
    `;
  }

  const best = bestCategoryForGoal(picks);
  const category = best ? (lang === "es" ? best.category_label_es : best.category_label_en) : null;
  const nVideos = best && progress.remaining > 0 ? videosNeeded(progress.remaining, best.earnings_per_sale) : 0;

  return `
    <div class="insight-card earnings-goal-card">
      <h3>${t("earnings_goal_title", lang)}</h3>
      <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${progress.pct}%"></div></div>
      <p class="goal-progress-text">${t("earnings_goal_progress", lang, { earned: formatMoney(progress.earned), goal: formatMoney(progress.goal) })}</p>
      ${
        progress.remaining > 0
          ? `<p class="goal-progress-text">
              ${t("earnings_goal_remaining", lang, { amount: formatMoney(progress.remaining) })}
              ${category && nVideos > 0 ? t("earnings_goal_videos_needed", lang, { n: nVideos, category }) : ""}
            </p>`
          : `<p class="goal-progress-text">${t("earnings_goal_reached", lang)}</p>`
      }
      <div class="earnings-goal-actions">
        <button type="button" class="btn-primary" data-action="toggle-log-earning">${t("log_earning_button", lang)}</button>
        <button type="button" class="btn-save-pill" data-action="toggle-edit-goal">${t("edit_goal_button", lang)}</button>
      </div>
      <form class="earnings-goal-form" data-form="log-earning" style="display:none">
        <input type="number" min="0" step="0.01" name="amount" placeholder="${t("log_earning_amount_label", lang)}" required />
        <input type="date" name="date" value="${today.toISOString().slice(0, 10)}" required />
        <button type="submit" class="btn-primary">${t("log_earning_button", lang)}</button>
      </form>
      <form class="earnings-goal-form" data-form="set-goal" style="display:none">
        <input type="number" min="0" step="1" name="goal" placeholder="${t("earnings_goal_set_label", lang)}" value="${progress.goal}" required />
        <button type="submit" class="btn-primary">${t("earnings_goal_save_button", lang)}</button>
      </form>
    </div>
  `;
}

function wireGoalCard(container: HTMLElement, rerender: () => void): void {
  const card = container.querySelector<HTMLElement>(".earnings-goal-card");
  if (!card) return;
  card.querySelector('[data-form="set-goal"]')?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("goal") as HTMLInputElement;
    const amount = Number(input.value);
    if (amount > 0) {
      setMonthlyGoal(amount);
      rerender();
    }
  });
  card.querySelector('[data-form="log-earning"]')?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const amount = Number((form.elements.namedItem("amount") as HTMLInputElement).value);
    const date = (form.elements.namedItem("date") as HTMLInputElement).value;
    if (amount > 0 && date) {
      addEntry(amount, date);
      rerender();
    }
  });
  card.querySelector('[data-action="toggle-log-earning"]')?.addEventListener("click", () => {
    const form = card.querySelector<HTMLElement>('[data-form="log-earning"]');
    if (form) form.style.display = form.style.display === "none" ? "flex" : "none";
  });
  card.querySelector('[data-action="toggle-edit-goal"]')?.addEventListener("click", () => {
    const form = card.querySelector<HTMLElement>('[data-form="set-goal"]');
    if (form) form.style.display = form.style.display === "none" ? "flex" : "none";
  });
}

export async function renderHoy(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: picksData, isSample }, { data: hooks }, statuses] = await Promise.all([
    loadPicks(),
    loadHooks(),
    getAllStatuses(),
  ]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  const today = new Date();
  const postedIds = new Set(Object.entries(statuses).filter(([, s]) => s === "posted").map(([id]) => id));
  const allPickIds = picksData.picks.map((p) => p.product_id);
  const todaysIds = productsToFilmToday(allPickIds, today, postedIds);
  const byId = new Map(picksData.picks.map((p) => [p.product_id, p]));
  const todaysPicks = todaysIds.map((id) => byId.get(id)).filter((p): p is Pick => p !== undefined);
  const [hero, ...rest] = todaysPicks;

  const seasonHtml = await seasonCountdownHtml(lang);
  const samplesBanner = hasUrgentSamples(getAllSamples(), today)
    ? `<a class="hoy-samples-banner" href="#/muestras">${t("hoy_samples_banner", lang)}</a>`
    : "";

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("hoy_title", lang)}</h2>
    ${samplesBanner}
    ${goalCardHtml(lang, picksData.picks, today)}
    ${seasonHtml}
    ${
      !hero
        ? `<p class="empty-state">${t("hoy_empty", lang)}</p>`
        : `${heroHtml(hero, hooks, today, lang, statuses[hero.product_id] === "filmed")}
           ${
             rest.length > 0
               ? `<h3 class="hoy-also-good-title">${t("hoy_also_good_title", lang)}</h3>
                  <div class="card-grid hoy-also-good-list">${rest.map((p) => alsoGoodCardHtml(p, hooks, today, lang, statuses[p.product_id] === "filmed")).join("")}</div>`
               : ""
           }`
    }
  `;

  wireGoalCard(container, () => void renderHoy(container, lang));

  container.querySelectorAll<HTMLButtonElement>('[data-action="mark-filmed"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const productId = btn.dataset.productId!;
      btn.classList.add("active");
      btn.textContent = t("marked_filmed_label", lang);
      btn.disabled = true;
      void setStatus(productId, "filmed");
    });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-action="request-sample"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const { productId, price, name } = btn.dataset;
      if (!productId) return;
      requestSample(productId, name ?? "", Number(price) || 0, today);
      btn.textContent = t("sample_requested_label", lang);
      btn.classList.add("active");
      btn.disabled = true;
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".copy-hashtags-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.dataset.hashtags ?? "";
      const originalLabel = btn.textContent;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          btn.textContent = t("copied_label", lang);
          setTimeout(() => {
            btn.textContent = originalLabel;
          }, 1500);
        })
        .catch(() => {
          // clipboard unavailable -- chips are still readable on their own
        });
    });
  });
}
