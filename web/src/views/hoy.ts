import { loadHooks, loadPicks, loadSeasons } from "../api";
import { assetUrl } from "../asset";
import { t, type Lang } from "../i18n";
import { getAllStatuses, setStatus } from "../pipeline";
import { productsToFilmToday } from "../rotation";
import { getAllSamples } from "../samples";
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

function hookSectionHtml(pick: Pick, hooks: HooksFile, today: Date, lang: Lang): string {
  const realHook = pick.formula_ganadora?.top_hooks[0];
  const templates = hooks.hooks[pick.category]?.[lang] ?? [];
  const template = pickForToday(templates, today);
  return `
    <div class="hoy-hook">
      ${realHook ? `<p class="hoy-hook-real"><span class="formula-label">${t("suggested_hook_label", lang)}</span> &ldquo;${realHook}&rdquo;</p>` : ""}
      ${template ? `<p class="hoy-hook-template"><span class="formula-label">${t("template_hook_label", lang)}</span> &ldquo;${template}&rdquo;</p>` : ""}
    </div>
  `;
}

function shotListHtml(pick: Pick, hooks: HooksFile, lang: Lang): string {
  const archetype = hooks.category_to_shot_list[pick.category];
  const steps = archetype ? (hooks.shot_lists[archetype]?.[lang] ?? []) : [];
  if (steps.length === 0) return "";
  return `
    <div class="hoy-shot-list">
      <span class="formula-label">${t("shot_list_label", lang)}</span>
      <ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
    </div>
  `;
}

function hashtagsHtml(pick: Pick, lang: Lang): string {
  const tags = (pick.formula_ganadora?.top_hashtags ?? []).slice(0, 5);
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

function cardHtml(pick: Pick, hooks: HooksFile, today: Date, lang: Lang, filmed: boolean): string {
  const earnLine = t("earn_headline", lang, { amount: pick.earnings_per_sale.toFixed(2) });
  return `
    <article class="pick-card hoy-card" data-product-id="${pick.product_id}">
      <a class="card-photo-link" href="#/product/${pick.product_id}">
        ${pick.image_url ? `<img class="card-photo" src="${assetUrl(pick.image_url)}" alt="${pick.clean_title}" loading="lazy" />` : `<div class="card-photo card-photo-placeholder"></div>`}
      </a>
      <div class="card-body">
        <h3 class="card-title">${pick.clean_title}</h3>
        <div class="card-earn">${earnLine}</div>
        ${hookSectionHtml(pick, hooks, today, lang)}
        ${shotListHtml(pick, hooks, lang)}
        <div class="formula-section">
          <span class="formula-label">${t("video_duration_label", lang)}</span>
          <div class="formula-value">${t("video_duration_range", lang, { lo: 13, hi: 30 })}</div>
        </div>
        ${hashtagsHtml(pick, lang)}
        <div class="card-actions">
          <a class="btn-primary" href="#/product/${pick.product_id}">${t("see_selling_videos_button", lang)}</a>
          <button
            type="button"
            class="btn-mark-filmed ${filmed ? "active" : ""}"
            data-action="mark-filmed"
            ${filmed ? "disabled" : ""}
          >${filmed ? t("marked_filmed_label", lang) : t("mark_filmed_button", lang)}</button>
        </div>
      </div>
    </article>
  `;
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

  const seasonHtml = await seasonCountdownHtml(lang);
  const samplesBanner = hasUrgentSamples(getAllSamples(), today)
    ? `<a class="hoy-samples-banner" href="#/muestras">${t("hoy_samples_banner", lang)}</a>`
    : "";

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("hoy_title", lang)}</h2>
    ${samplesBanner}
    ${seasonHtml}
    ${
      todaysPicks.length === 0
        ? `<p class="empty-state">${t("hoy_empty", lang)}</p>`
        : `<div class="card-grid hoy-card-list">${todaysPicks.map((p) => cardHtml(p, hooks, today, lang, statuses[p.product_id] === "filmed")).join("")}</div>`
    }
  `;

  container.querySelectorAll<HTMLElement>(".hoy-card").forEach((card) => {
    const productId = card.dataset.productId!;
    card.querySelector('[data-action="mark-filmed"]')?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.classList.add("active");
      btn.textContent = t("marked_filmed_label", lang);
      btn.disabled = true;
      void setStatus(productId, "filmed");
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
