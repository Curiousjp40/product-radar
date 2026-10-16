import { loadHooks, loadPicks, loadSeasons } from "../api";
import { assetUrl } from "../asset";
import { bestVideoTimeHtml } from "../bestTime";
import { getEntries, getMonthlyGoal } from "../earningsGoal";
import { earningsProgress, earningsThisMonth } from "../earningsGoalLogic";
import { categoryHidePromptHtml, countHiddenInCategory, wireCategoryHidePrompt } from "../hideProduct";
import { t, type Lang } from "../i18n";
import { getAllMisProductos, ownedProductIds } from "../misProductos";
import { getAllFeedback, getAllStatuses, getHiddenCategories, setFeedback, setStatus } from "../pipeline";
import { productsToFilmToday, reorderForHero } from "../rotation";
import { weeklyUnitsChangePct } from "../cardMetrics";
import { getAllSamples, hasRequestedSample, requestSample } from "../samples";
import { hasUrgentSamples } from "../samplesLogic";
import type { HooksFile, Pick } from "../types";
import { goalCardHtml, wireGoalCard } from "./goalCard";
import { productCardInfoHtml } from "./productCard";
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
      <button type="button" class="btn-not-for-me" data-action="not-for-me" data-product-id="${pick.product_id}" data-category="${pick.category}">${t("not_for_me_button", lang)}</button>
    </div>
  `;
}

function pickCardInput(pick: Pick) {
  return {
    earnings_per_sale: pick.earnings_per_sale,
    price: pick.price,
    commission_rate: pick.commission_rate,
    units_7d: pick.units_7d,
    daily_units_14: pick.daily_units_14,
    creator_count: pick.creator_count,
    ev_typical: pick.ev_typical,
    score: pick.score,
    saturation_badge: pick.saturation_badge,
  };
}

// The hero: one big "film this today" pick -- photo, the new "worth my
// time" info block, the one reason it's the pick, the best hook,
// hashtags, shot list behind a tap.
function heroHtml(
  pick: Pick,
  hooks: HooksFile,
  today: Date,
  lang: Lang,
  filmed: boolean,
  ownedIds: Set<string>,
  monthlyGoalRemaining: number | null,
): string {
  const why = lang === "es" ? pick.summary_es : pick.summary_en;
  const hook = bestHook(pick, hooks, today, lang);
  const infoHtml = productCardInfoHtml(pickCardInput(pick), {
    lang,
    monthlyGoalRemaining,
    isOwned: ownedIds.has(pick.product_id),
    pocasLatinas: pick.pocas_creadoras_latinas,
    seasonEventLabel: lang === "es" ? pick.season_event_label_es : pick.season_event_label_en,
  });
  return `
    <article class="hoy-hero" data-product-id="${pick.product_id}">
      <a class="hoy-hero-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="hoy-hero-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" loading="lazy" />` : `<div class="hoy-hero-photo hoy-hero-photo-placeholder"></div>`}
      </a>
      <div class="hoy-hero-body">
        <span class="hoy-hero-eyebrow">${t("hoy_hero_label", lang)}</span>
        <h3 class="hoy-hero-title">${pick.clean_title}</h3>
        ${infoHtml}
        ${why ? `<p class="hoy-hero-why">${why}</p>` : ""}
        ${hook ? `<p class="hoy-hook-real">&ldquo;${hook}&rdquo;</p>` : ""}
        ${bestVideoTimeHtml(pick.best_video_time, lang)}
        ${hashtagsHtml(pick, lang, 5)}
        ${shotListDetailsHtml(pick, hooks, lang)}
        ${actionButtons(pick, lang, filmed)}
      </div>
    </article>
  `;
}

// "Also good" -- smaller, condensed versions of the same card.
function alsoGoodCardHtml(
  pick: Pick,
  hooks: HooksFile,
  today: Date,
  lang: Lang,
  filmed: boolean,
  ownedIds: Set<string>,
  monthlyGoalRemaining: number | null,
): string {
  const hook = bestHook(pick, hooks, today, lang);
  const infoHtml = productCardInfoHtml(pickCardInput(pick), {
    lang,
    monthlyGoalRemaining,
    isOwned: ownedIds.has(pick.product_id),
    pocasLatinas: pick.pocas_creadoras_latinas,
    seasonEventLabel: lang === "es" ? pick.season_event_label_es : pick.season_event_label_en,
  });
  return `
    <article class="pick-card hoy-also-good" data-product-id="${pick.product_id}">
      <a class="card-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="card-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" loading="lazy" />` : `<div class="card-photo card-photo-placeholder"></div>`}
      </a>
      <div class="card-body">
        <h3 class="card-title">${pick.clean_title}</h3>
        ${infoHtml}
        ${hook ? `<p class="hoy-hook-real">&ldquo;${hook}&rdquo;</p>` : ""}
        ${hashtagsHtml(pick, lang, 3)}
        ${shotListDetailsHtml(pick, hooks, lang)}
        ${actionButtons(pick, lang, filmed)}
      </div>
    </article>
  `;
}

export async function renderHoy(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data: picksData, isSample }, { data: hooks }, statuses, feedback, misProductos, goal, entries] = await Promise.all([
    loadPicks(),
    loadHooks(),
    getAllStatuses(),
    getAllFeedback(),
    getAllMisProductos(),
    getMonthlyGoal(),
    getEntries(),
  ]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  const today = new Date();
  const ownedIds = ownedProductIds(misProductos);
  const progress = earningsProgress(goal, earningsThisMonth(entries, today));
  const monthlyGoalRemaining = progress ? progress.remaining : null;
  const hiddenCategories = new Set(getHiddenCategories());
  const visiblePicks = picksData.picks.filter(
    (p) => feedback[p.product_id] !== "not_for_me" && !hiddenCategories.has(p.category),
  );
  const categoryByProductId = new Map(picksData.picks.map((p) => [p.product_id, p.category]));
  const postedIds = new Set(Object.entries(statuses).filter(([, s]) => s === "posted").map(([id]) => id));
  const allPickIds = visiblePicks.map((p) => p.product_id);
  const rotatedIds = productsToFilmToday(allPickIds, today, postedIds, 9);
  const byId = new Map(visiblePicks.map((p) => [p.product_id, p]));
  // Part C "hero fix" (2026-10-16): never lead with a falling-sales
  // product -- "Gradalo primero" should be her best flat-or-rising bet,
  // not whichever happened to land first in the day's rotation.
  const todaysIds = reorderForHero(rotatedIds, (id) => weeklyUnitsChangePct(byId.get(id)?.daily_units_14 ?? []));
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
    ${await goalCardHtml(lang, picksData.picks, misProductos, today)}
    ${seasonHtml}
    ${
      !hero
        ? `<p class="empty-state">${t("hoy_empty", lang)}</p>`
        : `${heroHtml(hero, hooks, today, lang, statuses[hero.product_id] === "filmed", ownedIds, monthlyGoalRemaining)}
           ${
             rest.length > 0
               ? `<h3 class="hoy-also-good-title">${t("hoy_also_good_title", lang)}</h3>
                  <div class="card-grid hoy-also-good-list">${rest.map((p) => alsoGoodCardHtml(p, hooks, today, lang, statuses[p.product_id] === "filmed", ownedIds, monthlyGoalRemaining)).join("")}</div>`
               : ""
           }
           <a class="more-link" href="#/week">${t("ver_20_de_la_semana", lang, { n: picksData.picks.length })}</a>`
    }
  `;

  wireGoalCard(container, lang, () => void renderHoy(container, lang));
  wireCategoryHidePrompt(container, () => void renderHoy(container, lang));

  container.querySelectorAll<HTMLButtonElement>('[data-action="not-for-me"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { productId, category } = btn.dataset;
      if (!productId || !category) return;
      await setFeedback(productId, "not_for_me");
      const updatedFeedback = await getAllFeedback();
      if (!getHiddenCategories().includes(category) && countHiddenInCategory(updatedFeedback, categoryByProductId, category) >= 3) {
        const label = lang === "es" ? picksData.picks.find((p) => p.category === category)?.category_label_es : picksData.picks.find((p) => p.category === category)?.category_label_en;
        container.insertAdjacentHTML("beforeend", categoryHidePromptHtml(category, label ?? category, lang));
        wireCategoryHidePrompt(container, () => void renderHoy(container, lang));
      } else {
        void renderHoy(container, lang);
      }
    });
  });

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
