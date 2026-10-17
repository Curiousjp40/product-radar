import { loadSeasons } from "../api";
import { categoryLabel as resolveCategoryLabel } from "../categoryLabels";
import { locale, t, type Lang } from "../i18n";
import { countdownStatus, groupSeasonEvents } from "../seasonLogic";
import type { SeasonEvent } from "../types";

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

function datesLineHtml(ev: SeasonEvent, lang: Lang): string {
  if (!ev.film_start || !ev.film_end) {
    return `<div class="season-dates-tbd">${t("season_dates_tbd", lang)}</div>`;
  }
  const filmStart = t("season_start_filming", lang, { date: humanDate(ev.film_start, lang) });
  const eventPart = ev.event_date ? ` &middot; ${lang === "es" ? ev.label_es : ev.label_en}: ${humanDate(ev.event_date, lang)}` : "";
  return `<div class="season-dates-line">${filmStart}${eventPart}</div>`;
}

function categoryNamesHtml(ev: SeasonEvent, lang: Lang): string {
  const names = ev.categories.map((c) => resolveCategoryLabel(c, lang)).join(", ");
  return names ? `<div class="season-categories">${names}</div>` : "";
}

function eventCardHtml(ev: SeasonEvent, lang: Lang): string {
  return `
    <div class="season-card">
      <h3 style="margin:0 0 4px">${lang === "es" ? ev.label_es : ev.label_en}</h3>
      <div class="countdown">${countdownText(ev, lang)}</div>
      ${datesLineHtml(ev, lang)}
      ${categoryNamesHtml(ev, lang)}
    </div>
  `;
}

function sectionHtml(titleKey: string, events: SeasonEvent[], lang: Lang): string {
  if (events.length === 0) return "";
  return `
    <h3 class="season-section-title">${t(titleKey, lang)}</h3>
    ${events.map((ev) => eventCardHtml(ev, lang)).join("")}
  `;
}

export async function renderSeason(container: HTMLElement, lang: Lang): Promise<void> {
  container.innerHTML = `<p class="empty-state">...</p>`;
  const { data, isSample } = await loadSeasons();
  const banner = isSample ? `<div class="sample-banner">${t("sample_data_banner", lang)}</div>` : "";
  const groups = groupSeasonEvents(data.events);

  container.innerHTML = `
    ${banner}
    <h2 class="view-title">${t("season_title", lang)}</h2>
    ${sectionHtml("season_group_ahora", groups.ahora, lang)}
    ${sectionHtml("season_group_proximo", groups.proximo, lang)}
    ${sectionHtml("season_group_mas_adelante", groups.mas_adelante, lang)}
  `;
}
