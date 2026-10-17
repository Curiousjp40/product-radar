import { loadCandidates, loadSeasons } from "../api";
import { assetUrl, IMG_FALLBACK } from "../asset";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { backToTopButtonHtml, detailModalHtml, openDetailModal, wireBackToTop, wireDetailModal } from "../detailModal";
import { locale, t, type Lang } from "../i18n";
import { countdownStatus, displayCategories, groupSeasonEvents, progressFraction, timelineSpan } from "../seasonLogic";
import { themeForEvent } from "../seasonTheme";
import type { Candidate, SeasonEvent } from "../types";
import { productCardInfoHtml } from "./productCard";

export { daysUntil, groupSeasonEvents } from "../seasonLogic";

export function countdownText(ev: SeasonEvent, lang: Lang): string {
  const status = countdownStatus(ev);
  switch (status.kind) {
    case "tbd":
      return t("season_dates_tbd", lang);
    case "already_passed":
      return t("season_already_passed", lang);
    case "window_open":
      return t("season_window_open", lang, { days: status.days });
    case "starts_in":
      return t("season_starts_in", lang, { days: status.days });
  }
}

function humanDate(dateStr: string, lang: Lang): string {
  const date = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(locale(lang), { day: "numeric", month: "short", timeZone: "UTC" });
}

function eventLabel(ev: SeasonEvent, lang: Lang): string {
  return lang === "es" ? ev.label_es : ev.label_en;
}

// Design review item 4: two clear date chips instead of a run-on line.
function dateChipsHtml(ev: SeasonEvent, lang: Lang): string {
  if (!ev.film_start && !ev.event_date && !ev.film_end) {
    return `<div class="season-dates-tbd">${t("season_dates_tbd", lang)}</div>`;
  }
  const chips: string[] = [];
  if (ev.film_start) chips.push(`<span class="season-date-chip">${t("season_start_filming", lang, { date: humanDate(ev.film_start, lang) })}</span>`);
  const anchor = ev.event_date ?? ev.film_end;
  if (anchor) chips.push(`<span class="season-date-chip">${t("season_event_date_label", lang, { label: eventLabel(ev, lang), date: humanDate(anchor, lang) })}</span>`);
  return `<div class="season-date-chips">${chips.join("")}</div>`;
}

function statusPillHtml(ev: SeasonEvent, lang: Lang): string {
  const status = countdownStatus(ev);
  if (status.kind === "window_open") return `<span class="season-status-pill status-ahora">${t("season_status_ahora", lang)}</span>`;
  if (status.kind === "already_passed") return `<span class="season-status-pill status-terminado">${t("season_status_terminado", lang)}</span>`;
  if (status.kind === "starts_in") return `<span class="season-status-pill status-en-dias">${t("season_status_en_dias", lang, { days: status.days })}</span>`;
  return "";
}

function matchingCandidates(ev: SeasonEvent, candidates: Candidate[], limit: number): Candidate[] {
  return [...candidates]
    .filter((c) => !c.suspicious && ev.categories.includes(c.category))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

function productThumbsHtml(products: Candidate[], max: number): string {
  const shown = products.slice(0, max);
  if (shown.length === 0) return "";
  return `
    <div class="season-product-thumbs">
      ${shown.map((c) => (c.image_url ? `<img src="${assetUrl(c.image_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="season-thumb-placeholder"></div>`)).join("")}
    </div>
  `;
}

function candidateDetailHtml(c: Candidate, lang: Lang): string {
  const infoHtml = productCardInfoHtml(
    {
      earnings_per_sale: c.earnings_per_sale,
      price: c.price,
      commission_rate: c.commission_rate,
      units_7d: c.units_7d,
      daily_units_14: c.daily_units,
      creator_count: c.creator_count,
      ev_typical: c.ev_typical,
      score: c.score,
      saturation_badge: c.saturation_badge,
    },
    { lang, risingFast: c.rising_fast, pocasLatinas: c.pocas_creadoras_latinas },
  );
  return `
    <div class="week-detail-inner">
      <div class="week-detail-photo-wrap">
        ${c.image_url ? `<img class="week-detail-photo" src="${assetUrl(c.image_url)}" alt="${c.clean_title}" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="week-detail-photo week-detail-photo-placeholder"></div>`}
      </div>
      <h3 class="week-detail-title">${c.clean_title}</h3>
      <div class="week-detail-meta">${lang === "es" ? c.category_label_es : c.category_label_en}</div>
      ${infoHtml}
      <div class="card-actions week-detail-actions">
        <a class="btn-primary" href="${c.tiktok_shop_url}" target="_blank" rel="noopener">${t("open_in_tiktok_shop", lang)}</a>
        <a class="btn-save-pill" href="#/product/${c.product_id}">${t("ver_todos_detalles_button", lang)}</a>
      </div>
    </div>
  `;
}

function productCardHtml(c: Candidate, lang: Lang): string {
  const infoHtml = productCardInfoHtml(
    {
      earnings_per_sale: c.earnings_per_sale,
      price: c.price,
      commission_rate: c.commission_rate,
      units_7d: c.units_7d,
      daily_units_14: c.daily_units,
      creator_count: c.creator_count,
      ev_typical: c.ev_typical,
      score: c.score,
      saturation_badge: c.saturation_badge,
    },
    { lang, compact: true, risingFast: c.rising_fast, pocasLatinas: c.pocas_creadoras_latinas },
  );
  return `
    <article class="pick-card season-product-card" data-open-detail="${c.product_id}">
      <div class="card-photo-link">
        ${c.image_url ? `<img class="card-photo" src="${assetUrl(c.image_url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMG_FALLBACK}'" />` : `<div class="card-photo card-photo-placeholder"></div>`}
      </div>
      <div class="card-body">
        <h3 class="card-title">${c.clean_title}</h3>
        ${infoHtml}
      </div>
    </article>
  `;
}

// Design review item 1: hero banner, themed per event, with a big
// countdown, filming-window progress bar, and 2-3 "what to do now" tips.
function heroHtml(ev: SeasonEvent, candidates: Candidate[], lang: Lang): string {
  const theme = themeForEvent(ev.id);
  const status = countdownStatus(ev);
  const anchor = ev.event_date ?? ev.film_end;
  const pct = progressFraction(ev.film_start, anchor);
  const label = eventLabel(ev, lang);

  let countdownHeadline = countdownText(ev, lang);
  if (status.kind === "window_open") countdownHeadline = t("season_hero_countdown_window", lang, { days: status.days, label });
  else if (status.kind === "starts_in") countdownHeadline = t("season_hero_countdown_upcoming", lang, { days: status.days, label });

  const tips: string[] = [];
  if (status.kind === "window_open") {
    tips.push(t("season_tip_film_now", lang));
    if (anchor) tips.push(t("season_tip_post_before", lang, { date: humanDate(anchor, lang) }));
  } else if (status.kind === "starts_in") {
    if (ev.film_start) tips.push(t("season_tip_start_filming", lang, { date: humanDate(ev.film_start, lang) }));
    tips.push(t("season_tip_save_ideas", lang));
  }

  const products = matchingCandidates(ev, candidates, 8);

  return `
    <div class="season-hero" style="--season-bg:${theme.bg};--season-fg:${theme.fg};--season-accent:${theme.accent}">
      <div class="season-hero-icon">${theme.icon}</div>
      <h2 class="season-hero-headline">${countdownHeadline}</h2>
      ${
        pct !== null
          ? `<div class="season-hero-progress"><div class="season-hero-progress-fill" style="width:${pct}%"></div></div>`
          : ""
      }
      ${dateChipsHtml(ev, lang)}
      ${
        tips.length > 0
          ? `<div class="season-hero-tips">
              <p class="season-hero-tips-title">${t("season_que_hacer_title", lang)}</p>
              <ul>${tips.map((tip) => `<li>${tip}</li>`).join("")}</ul>
            </div>`
          : ""
      }
    </div>
    ${
      products.length > 0
        ? `<h3 class="season-section-title">${t("season_products_title", lang)}</h3>
           <div class="season-product-strip">${products.map((c) => productCardHtml(c, lang)).join("")}</div>`
        : ""
    }
  `;
}

const TIMELINE_MONTHS = 8;

// Design review item 3: a horizontal month strip, each event a colored
// bar spanning its filming window, with a "today" marker.
function timelineHtml(events: SeasonEvent[], lang: Lang, today: Date): string {
  const baseYear = today.getUTCFullYear();
  const baseMonth0 = today.getUTCMonth();
  const monthLabels = Array.from({ length: TIMELINE_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(baseYear, baseMonth0 + i, 1));
    return d.toLocaleDateString(locale(lang), { month: "short", timeZone: "UTC" });
  });
  const bars = events
    .map((ev) => ({ ev, span: timelineSpan(ev, baseYear, baseMonth0, TIMELINE_MONTHS) }))
    .filter((e) => e.span.visible);
  if (bars.length === 0) return "";

  const todayCol = 1; // today is always within the first visible month (the strip starts this month)
  const dayOfMonthPct = (today.getUTCDate() / 30) * 100;

  return `
    <h3 class="season-section-title">${t("nav_season", lang)}</h3>
    <div class="season-timeline">
      <div class="season-timeline-months" style="grid-template-columns:repeat(${TIMELINE_MONTHS},1fr)">
        ${monthLabels.map((m) => `<div class="season-timeline-month-label">${m}</div>`).join("")}
      </div>
      <div class="season-timeline-track" style="grid-template-columns:repeat(${TIMELINE_MONTHS},1fr)">
        <div class="season-timeline-today" style="grid-column:${todayCol};left:${dayOfMonthPct}%" title="${t("season_status_ahora", lang)}"></div>
        ${bars
          .map(({ ev, span }) => {
            const theme = themeForEvent(ev.id);
            return `<div class="season-timeline-bar" data-timeline-jump="${ev.id}" style="grid-column:${span.startCol} / span ${span.span};background:${theme.accent}" title="${eventLabel(ev, lang)}"><span>${theme.icon} ${eventLabel(ev, lang)}</span></div>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function eventCardHtml(ev: SeasonEvent, candidates: Candidate[], lang: Lang): string {
  const theme = themeForEvent(ev.id);
  const cats = displayCategories(ev.categories);
  const products = matchingCandidates(ev, candidates, 3);
  return `
    <div class="season-card" id="season-event-${ev.id}" style="--season-accent:${theme.accent}">
      <div class="season-card-header">
        <span class="season-card-icon">${theme.icon}</span>
        <h3 style="margin:0">${eventLabel(ev, lang)}</h3>
        ${statusPillHtml(ev, lang)}
      </div>
      ${dateChipsHtml(ev, lang)}
      ${cats.length > 0 ? `<div class="season-categories">${cats.map((c) => resolveCategoryLabel(c, lang)).join(", ")}</div>` : ""}
      ${productThumbsHtml(products, 3)}
    </div>
  `;
}

function sectionHtml(titleKey: string, events: SeasonEvent[], candidates: Candidate[], lang: Lang): string {
  if (events.length === 0) return "";
  return `
    <h3 class="season-section-title">${t(titleKey, lang)}</h3>
    ${events.map((ev) => eventCardHtml(ev, candidates, lang)).join("")}
  `;
}

// Design review item 6: past events collapse into a closed-by-default
// <details> instead of cluttering the main timeline.
function pasadasHtml(events: SeasonEvent[], candidates: Candidate[], lang: Lang): string {
  if (events.length === 0) return "";
  return `
    <details class="season-pasadas-details">
      <summary>${t("season_group_pasadas", lang)} (${events.length})</summary>
      ${events.map((ev) => eventCardHtml(ev, candidates, lang)).join("")}
    </details>
  `;
}

export async function renderSeason(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const [{ data, isSample }, { data: candidatesData }] = await Promise.all([loadSeasons(), loadCandidates()]);
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  const today = new Date();
  const groups = groupSeasonEvents(data.events, today);
  const heroEvent = groups.ahora[0] ?? groups.proximo[0] ?? null;
  const timelineEvents = [...groups.ahora, ...groups.proximo, ...groups.mas_adelante];

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("season_title", lang)}</h2>
    ${heroEvent ? heroHtml(heroEvent, candidatesData.candidates, lang) : ""}
    ${timelineHtml(timelineEvents, lang, today)}
    ${sectionHtml("season_group_ahora", groups.ahora, candidatesData.candidates, lang)}
    ${sectionHtml("season_group_proximo", groups.proximo, candidatesData.candidates, lang)}
    ${sectionHtml("season_group_mas_adelante", groups.mas_adelante, candidatesData.candidates, lang)}
    ${pasadasHtml(groups.pasadas, candidatesData.candidates, lang)}
    ${detailModalHtml()}
    ${backToTopButtonHtml(lang)}
  `;

  wireDetailModal(container);
  wireBackToTop(container);

  const candidatesById = new Map(candidatesData.candidates.map((c) => [c.product_id, c]));
  container.querySelectorAll<HTMLElement>("[data-open-detail]").forEach((card) => {
    card.addEventListener("click", () => {
      const c = candidatesById.get(card.dataset.openDetail!);
      if (c) openDetailModal(container, candidateDetailHtml(c, lang));
    });
  });

  container.querySelectorAll<HTMLElement>("[data-timeline-jump]").forEach((bar) => {
    bar.addEventListener("click", () => {
      const target = container.querySelector(`#season-event-${bar.dataset.timelineJump}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}
